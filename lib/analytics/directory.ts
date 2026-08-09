import "server-only";
import { prisma } from "@/lib/db";
import { median } from "./stats";

/**
 * The directory layer: search, filter, sort and pagination over companies.
 *
 * A row is one company in one cycle of one batch. It is built from student
 * submissions; where the imported spreadsheets also cover that company and
 * cycle, the imported figures are attached to the same row and labelled rather
 * than merged into it. Student-reported values always lead — a cutoff a
 * classmate heard announced this season beats one a spreadsheet recorded two
 * seasons ago, and the imported figure fills the cell only when nobody has
 * reported one.
 *
 * Everything is filtered and counted in memory. A batch is a few hundred rows,
 * the row shape is a fold over two sources that SQL cannot express in one pass,
 * and doing it here keeps facet counts and result counts derived from exactly
 * the same list rather than from two queries that can disagree.
 *
 * Every option is expressed in the URL by the pages that use it, so a view is
 * shareable, the back button works, and a filtered result can be linked into a
 * WhatsApp group — which is how this data actually travels.
 */

export const SORT_KEYS = ["name", "ctc", "stipend", "reports", "date", "cutoff"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type SortDirection = "asc" | "desc";

export type SourceFilter = "students" | "imported";

export type DirectoryQuery = {
  batchYear: number;
  /** Free text, matched against company name and every recorded alias. */
  search?: string;
  tierKeys?: string[];
  branchCodes?: string[];
  cycles?: Array<"SUMMER_INTERNSHIP" | "SIX_MONTH_INTERNSHIP" | "FULL_TIME">;
  roleFamilies?: string[];
  sources?: SourceFilter[];
  minCtcLpa?: number;
  maxCtcLpa?: number;
  sort?: SortKey;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
};

export type DirectoryRow = {
  /** Stable across both layers: one company, one cycle. */
  key: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  parentName: string | null;
  cycle: string;

  /** Submissions filed for this company and cycle. The live number. */
  reports: number;
  /** Headcount the spreadsheets published. Null when no import covers this. */
  importedPlaced: number | null;
  /** Drive outcome, meaningful only where an import exists. */
  importedStatus: string | null;

  roleTitles: string[];
  tierKeys: string[];
  /** Branches called for, as students reported them; else the imported list. */
  eligibleBranches: string[];

  highestCtcLpa: number | null;
  highestStipendInr: number | null;
  firstYearCashLpa: number | null;

  cgpaCutoff: number | null;
  /** The raw string where it came from an import ("8(+ Resume)"). */
  cgpaCutoffLabel: string | null;
  cutoffSource: "students" | "imported" | null;

  date: Date | null;
  dateSource: "students" | "imported" | null;
  isRepeatVisit: boolean;
};

export type DirectoryResult = {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** How many rows have live submissions behind them, across the whole batch. */
  reportedRows: number;
  /** Counts for each filter value across the CURRENT result set minus that
   *  filter, so a facet never shows a choice that would return nothing. */
  facets: {
    tiers: Array<{ key: string; label: string; count: number }>;
    branches: Array<{ key: string; count: number }>;
    cycles: Array<{ key: string; count: number }>;
    sources: Array<{ key: string; count: number }>;
  };
};

export const DEFAULT_PAGE_SIZE = 25;

type Accumulator = DirectoryRow & { roleFamilies: Set<string>; aliases: string[] };

function blank(
  company: { id: string; name: string; slug: string; parent: { name: string } | null },
  cycle: string,
  aliases: string[],
): Accumulator {
  return {
    key: `${company.id}::${cycle}`,
    companyId: company.id,
    companyName: company.name,
    companySlug: company.slug,
    parentName: company.parent?.name ?? null,
    cycle,
    reports: 0,
    importedPlaced: null,
    importedStatus: null,
    roleTitles: [],
    tierKeys: [],
    eligibleBranches: [],
    highestCtcLpa: null,
    highestStipendInr: null,
    firstYearCashLpa: null,
    cgpaCutoff: null,
    cgpaCutoffLabel: null,
    cutoffSource: null,
    date: null,
    dateSource: null,
    isRepeatVisit: false,
    roleFamilies: new Set<string>(),
    aliases,
  };
}

const higher = (current: number | null, candidate: number | null) =>
  candidate !== null && (current === null || candidate > current) ? candidate : current;

async function buildRows(batchYear: number): Promise<Accumulator[]> {
  const [offers, drives] = await Promise.all([
    prisma.offer.findMany({
      where: {
        batch: { year: batchYear },
        deletedAt: null,
        verification: { not: "REMOVED" },
      },
      select: {
        roleTitle: true,
        roleFamily: true,
        cycle: true,
        tierKey: true,
        offerDate: true,
        createdAt: true,
        announcedCgpaCutoff: true,
        eligibleBranches: true,
        branch: { select: { code: true } },
        rounds: { select: { heldOn: true }, orderBy: { sequence: "asc" } },
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            parent: { select: { name: true } },
            aliases: { select: { alias: true } },
          },
        },
        compensation: {
          select: { ctcLpa: true, stipendPerMonthInr: true, firstYearCashLpa: true },
        },
      },
    }),
    prisma.drive.findMany({
      where: { batch: { year: batchYear } },
      select: {
        cycle: true,
        status: true,
        visitNumber: true,
        pptDate: true,
        eligibleBranches: true,
        gpaCutoffRaw: true,
        gpaCutoffNumeric: true,
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            parent: { select: { name: true } },
            aliases: { select: { alias: true } },
          },
        },
        roles: {
          select: {
            title: true,
            roleFamily: true,
            tierKey: true,
            placedInternship: true,
            placedFte: true,
            placedBoth: true,
            compensation: {
              select: {
                id: true,
                ctcLpa: true,
                stipendPerMonthInr: true,
                firstYearCashLpa: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const rows = new Map<string, Accumulator>();
  const at = (
    company: { id: string; name: string; slug: string; parent: { name: string } | null; aliases: Array<{ alias: string }> },
    cycle: string,
  ) => {
    const key = `${company.id}::${cycle}`;
    let row = rows.get(key);
    if (!row) {
      row = blank(company, cycle, company.aliases.map((alias) => alias.alias));
      rows.set(key, row);
    }
    return row;
  };

  // --- the live layer -------------------------------------------------------
  const cutoffsByKey = new Map<string, number[]>();

  for (const offer of offers) {
    const row = at(offer.company, offer.cycle);
    row.reports += 1;
    row.roleFamilies.add(offer.roleFamily);
    if (offer.roleTitle && !row.roleTitles.includes(offer.roleTitle)) {
      row.roleTitles.push(offer.roleTitle);
    }
    if (offer.tierKey && !row.tierKeys.includes(offer.tierKey)) row.tierKeys.push(offer.tierKey);

    for (const code of offer.eligibleBranches) {
      if (!row.eligibleBranches.includes(code)) row.eligibleBranches.push(code);
    }
    // A student who did not say who else was eligible has at least told us that
    // their own branch was.
    if (offer.eligibleBranches.length === 0 && offer.branch?.code) {
      if (!row.eligibleBranches.includes(offer.branch.code)) {
        row.eligibleBranches.push(offer.branch.code);
      }
    }

    const pkg = offer.compensation;
    row.highestCtcLpa = higher(row.highestCtcLpa, pkg?.ctcLpa ? Number(pkg.ctcLpa) : null);
    row.highestStipendInr = higher(
      row.highestStipendInr,
      pkg?.stipendPerMonthInr ? Number(pkg.stipendPerMonthInr) : null,
    );
    row.firstYearCashLpa = higher(
      row.firstYearCashLpa,
      pkg?.firstYearCashLpa ? Number(pkg.firstYearCashLpa) : null,
    );

    if (offer.announcedCgpaCutoff !== null) {
      const bucket = cutoffsByKey.get(row.key);
      if (bucket) bucket.push(Number(offer.announcedCgpaCutoff));
      else cutoffsByKey.set(row.key, [Number(offer.announcedCgpaCutoff)]);
    }

    const stamp = offer.offerDate ?? offer.rounds.map((round) => round.heldOn).find(Boolean) ?? null;
    if (stamp && (row.date === null || stamp < row.date)) {
      row.date = stamp;
      row.dateSource = "students";
    }
  }

  // Students disagreeing about the announced bar is normal; the median is the
  // least wrong single answer and stops one mishearing setting the column.
  for (const [key, values] of cutoffsByKey) {
    const row = rows.get(key);
    if (!row) continue;
    const value = median(values);
    if (value === null) continue;
    row.cgpaCutoff = value;
    row.cgpaCutoffLabel = value.toFixed(2);
    row.cutoffSource = "students";
  }

  // --- the imported layer, filling only what nobody reported ----------------
  for (const drive of drives) {
    const row = at(drive.company, drive.cycle);
    row.importedStatus = drive.status;
    row.isRepeatVisit = row.isRepeatVisit || drive.visitNumber > 1;

    const placed = drive.roles.reduce(
      (sum, role) =>
        sum + (role.placedInternship ?? 0) + (role.placedFte ?? 0) + (role.placedBoth ?? 0),
      0,
    );
    row.importedPlaced = (row.importedPlaced ?? 0) + placed;

    for (const role of drive.roles) {
      row.roleFamilies.add(role.roleFamily);
      if (role.title && !row.roleTitles.includes(role.title)) row.roleTitles.push(role.title);
      if (role.tierKey && !row.tierKeys.includes(role.tierKey)) row.tierKeys.push(role.tierKey);
    }

    if (row.eligibleBranches.length === 0) row.eligibleBranches = [...drive.eligibleBranches];

    // Packages: shared compensation rows count once, and a student-reported
    // figure is never overwritten by an advertised one.
    const seen = new Set<string>();
    for (const role of drive.roles) {
      const pkg = role.compensation;
      if (!pkg || seen.has(pkg.id)) continue;
      seen.add(pkg.id);
      if (row.reports === 0) {
        row.highestCtcLpa = higher(row.highestCtcLpa, pkg.ctcLpa ? Number(pkg.ctcLpa) : null);
        row.highestStipendInr = higher(
          row.highestStipendInr,
          pkg.stipendPerMonthInr ? Number(pkg.stipendPerMonthInr) : null,
        );
        row.firstYearCashLpa = higher(
          row.firstYearCashLpa,
          pkg.firstYearCashLpa ? Number(pkg.firstYearCashLpa) : null,
        );
      }
    }

    if (row.cutoffSource === null && drive.gpaCutoffNumeric !== null) {
      row.cgpaCutoff = Number(drive.gpaCutoffNumeric);
      row.cgpaCutoffLabel = drive.gpaCutoffRaw ?? Number(drive.gpaCutoffNumeric).toFixed(2);
      row.cutoffSource = "imported";
    }
    if (row.dateSource === null && drive.pptDate) {
      row.date = drive.pptDate;
      row.dateSource = "imported";
    }
  }

  return [...rows.values()];
}

type FilterKey = "search" | "tierKeys" | "branchCodes" | "cycles" | "roleFamilies" | "sources" | "ctc";

function matches(row: Accumulator, query: DirectoryQuery, omit?: FilterKey): boolean {
  if (omit !== "search" && query.search?.trim()) {
    const term = query.search.trim().toLowerCase();
    const hit =
      row.companyName.toLowerCase().includes(term) ||
      row.aliases.some((alias) => alias.toLowerCase().includes(term));
    if (!hit) return false;
  }

  if (omit !== "tierKeys" && query.tierKeys?.length) {
    if (!row.tierKeys.some((key) => query.tierKeys!.includes(key))) return false;
  }

  if (omit !== "branchCodes" && query.branchCodes?.length) {
    if (!row.eligibleBranches.some((code) => query.branchCodes!.includes(code))) return false;
  }

  if (omit !== "cycles" && query.cycles?.length) {
    if (!query.cycles.includes(row.cycle as never)) return false;
  }

  if (omit !== "roleFamilies" && query.roleFamilies?.length) {
    if (![...row.roleFamilies].some((family) => query.roleFamilies!.includes(family))) return false;
  }

  if (omit !== "sources" && query.sources?.length) {
    const isReported = row.reports > 0;
    const wanted = query.sources.includes(isReported ? "students" : "imported");
    if (!wanted) return false;
  }

  if (omit !== "ctc" && (query.minCtcLpa !== undefined || query.maxCtcLpa !== undefined)) {
    if (row.highestCtcLpa === null) return false;
    if (query.minCtcLpa !== undefined && row.highestCtcLpa < query.minCtcLpa) return false;
    if (query.maxCtcLpa !== undefined && row.highestCtcLpa > query.maxCtcLpa) return false;
  }

  return true;
}

export async function queryDirectory(query: DirectoryQuery): Promise<DirectoryResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const [all, batch] = await Promise.all([
    buildRows(query.batchYear),
    prisma.batch.findUnique({
      where: { year: query.batchYear },
      include: { tierConfigs: { orderBy: { rank: "asc" } } },
    }),
  ]);

  const rows = all.filter((row) => matches(row, query));

  const direction = query.direction ?? (query.sort === "name" ? "asc" : "desc");
  const factor = direction === "asc" ? 1 : -1;
  const nullsLast = (value: number | null) =>
    value === null ? (direction === "asc" ? Infinity : -Infinity) : value;

  rows.sort((a, b) => {
    switch (query.sort) {
      case "ctc":
        return (nullsLast(a.highestCtcLpa) - nullsLast(b.highestCtcLpa)) * factor;
      case "stipend":
        return (nullsLast(a.highestStipendInr) - nullsLast(b.highestStipendInr)) * factor;
      case "reports":
        // Rows nobody has reported sort below rows that have one, whatever the
        // spreadsheet claims: the point of the column is live coverage.
        return (a.reports - b.reports) * factor || a.companyName.localeCompare(b.companyName);
      case "cutoff":
        return (nullsLast(a.cgpaCutoff) - nullsLast(b.cgpaCutoff)) * factor;
      case "date":
        return (
          ((a.date?.getTime() ?? (direction === "asc" ? Infinity : -Infinity)) -
            (b.date?.getTime() ?? (direction === "asc" ? Infinity : -Infinity))) *
          factor
        );
      case "name":
      default:
        return a.companyName.localeCompare(b.companyName) * factor;
    }
  });

  const countBy = <T>(omit: FilterKey, keysOf: (row: Accumulator) => T[]) => {
    const counts = new Map<T, number>();
    for (const row of all) {
      if (!matches(row, query, omit)) continue;
      for (const key of new Set(keysOf(row))) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const tierCounts = countBy("tierKeys", (row) => row.tierKeys);
  const branchCounts = countBy("branchCodes", (row) => row.eligibleBranches);
  const cycleCounts = countBy("cycles", (row) => [row.cycle]);
  const sourceCounts = countBy("sources", (row) => [row.reports > 0 ? "students" : "imported"]);

  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(rows.length / pageSize)),
    reportedRows: all.filter((row) => row.reports > 0).length,
    facets: {
      tiers: (batch?.tierConfigs ?? []).map((tier) => ({
        key: tier.key,
        label: tier.label,
        count: tierCounts.get(tier.key) ?? 0,
      })),
      branches: [...branchCounts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      cycles: [...cycleCounts.entries()].map(([key, count]) => ({ key, count })),
      sources: [...sourceCounts.entries()].map(([key, count]) => ({ key, count })),
    },
  };
}

/** Type-ahead for the submission form and the search box. */
export async function searchCompanies(term: string, limit = 8) {
  if (!term.trim()) return [];
  return prisma.company.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, name: true, slug: true, _count: { select: { drives: true } } },
    orderBy: { name: "asc" },
    take: limit,
  });
}
