import type { OfferCycle, RoleFamily } from "@/generated/prisma/enums";
import "server-only";
import { cacheBatchRead } from "./cache";
import { getTierConfigs } from "./config";
import { prisma } from "@/lib/db";
import { median } from "./stats";
import { gate } from "@/lib/privacy/gate";

/** One submission aggregate per company/cycle; filters and facets share the same rows. */

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
  cycles?: OfferCycle[];
  roleFamilies?: RoleFamily[];
  sources?: SourceFilter[];
  minCtcLpa?: number;
  maxCtcLpa?: number;
  sort?: SortKey;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
};

export type DirectoryRow = {
  /** One company and recruiting cycle. */
  key: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  parentName: string | null;
  cycle: OfferCycle;

  /** All submissions for this company and cycle. */
  reports: number;
  studentReports: number;
  historicalReports: number;

  roleTitles: string[];
  tierKeys: string[];
  /** Branches called for, as students reported them; else the imported list. */
  eligibleBranches: string[];

  highestCtcLpa: number | null;
  highestStipendInr: number | null;
  firstYearCashLpa: number | null;

  cgpaCutoff: number | null;
  date: Date | null;
};

export type DirectoryResult = {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** How many rows have live submissions behind them, in the current result set. */
  reportedRows: number;
  /** Counts for each filter value across the CURRENT result set minus that
   *  filter, so a facet never shows a choice that would return nothing. */
  facets: {
    tiers: Array<{ key: string; label: string; count: number }>;
    branches: Array<{ key: string; count: number }>;
    cycles: Array<{ key: OfferCycle; count: number }>;
    sources: Array<{ key: string; count: number }>;
  };
};

export const DEFAULT_PAGE_SIZE = 25;

type Accumulator = DirectoryRow & {
  roleFamilies: Set<RoleFamily>;
  aliases: string[];
  ctcReports: number;
  stipendReports: number;
  cashReports: number;
};

function blank(
  company: { id: string; name: string; slug: string; parent: { name: string } | null },
  cycle: OfferCycle,
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
    studentReports: 0,
    historicalReports: 0,
    ctcReports: 0,
    stipendReports: 0,
    cashReports: 0,
    roleTitles: [],
    tierKeys: [],
    eligibleBranches: [],
    highestCtcLpa: null,
    highestStipendInr: null,
    firstYearCashLpa: null,
    cgpaCutoff: null,
    date: null,
    roleFamilies: new Set<RoleFamily>(),
    aliases,
  };
}

const higher = (current: number | null, candidate: number | null) =>
  candidate !== null && (current === null || candidate > current) ? candidate : current;

async function buildRows(batchYear: number): Promise<Accumulator[]> {
  const offers = await prisma.offer.findMany({
      where: {
        batch: { year: batchYear },
        deletedAt: null,
        verification: { not: "REMOVED" },
      },
      select: {
        source: true,
        roleTitle: true,
        roleFamily: true,
        cycle: true,
        tierKey: true,
        offerDate: true,
        announcedCgpaCutoff: true,
        eligibleBranches: true,
        branch: { select: { code: true } },
        rounds: { where: { heldOn: { not: null } }, select: { heldOn: true }, orderBy: { heldOn: "asc" }, take: 1 },
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
    });

  const rows = new Map<string, Accumulator>();
  const at = (
    company: { id: string; name: string; slug: string; parent: { name: string } | null; aliases: Array<{ alias: string }> },
    cycle: OfferCycle,
  ) => {
    const key = `${company.id}::${cycle}`;
    let row = rows.get(key);
    if (!row) {
      row = blank(company, cycle, company.aliases.map((alias) => alias.alias));
      rows.set(key, row);
    }
    return row;
  };

  const cutoffsByKey = new Map<string, number[]>();

  for (const offer of offers) {
    const row = at(offer.company, offer.cycle);
    row.reports += 1;
    if (offer.source === "OFFICIAL_IMPORT") row.historicalReports += 1;
    else row.studentReports += 1;
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
    if (pkg?.ctcLpa != null) row.ctcReports += 1;
    if (pkg?.stipendPerMonthInr != null) row.stipendReports += 1;
    if (pkg?.firstYearCashLpa != null) row.cashReports += 1;
    row.highestCtcLpa = higher(row.highestCtcLpa, pkg?.ctcLpa != null ? Number(pkg.ctcLpa) : null);
    row.highestStipendInr = higher(
      row.highestStipendInr,
      pkg?.stipendPerMonthInr != null ? Number(pkg.stipendPerMonthInr) : null,
    );
    row.firstYearCashLpa = higher(
      row.firstYearCashLpa,
      pkg?.firstYearCashLpa != null ? Number(pkg.firstYearCashLpa) : null,
    );

    if (offer.announcedCgpaCutoff !== null) {
      const bucket = cutoffsByKey.get(row.key);
      if (bucket) bucket.push(Number(offer.announcedCgpaCutoff));
      else cutoffsByKey.set(row.key, [Number(offer.announcedCgpaCutoff)]);
    }

    const stamp = offer.offerDate ?? offer.rounds[0]?.heldOn ?? null;
    if (stamp && (row.date === null || stamp < row.date)) {
      row.date = stamp;
    }
  }

  for (const row of rows.values()) {
    for (const [amount, count] of [
      ["highestCtcLpa", "ctcReports"],
      ["highestStipendInr", "stipendReports"],
      ["firstYearCashLpa", "cashReports"],
    ] as const) {
      const result = gate(row[count], () => row[amount]);
      row[amount] = result.suppressed ? null : result.value;
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
  }

  return [...rows.values()];
}

const readStoredRows = cacheBatchRead("directory-v4", async (batchYear: number) =>
  (await buildRows(batchYear)).map(({ roleFamilies, date, ...row }) =>
    Object.assign({}, row, { roleFamilies: [...roleFamilies], date: date?.toISOString() ?? null }),
  ),
);

async function loadRows(batchYear: number): Promise<Accumulator[]> {
  return (await readStoredRows(batchYear)).map((row) => Object.assign({}, row, {
    roleFamilies: new Set(row.roleFamilies), date: row.date ? new Date(row.date) : null,
  }));
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
    if (!query.cycles.includes(row.cycle)) return false;
  }

  if (omit !== "roleFamilies" && query.roleFamilies?.length) {
    if (![...row.roleFamilies].some((family) => query.roleFamilies!.includes(family))) return false;
  }

  if (omit !== "sources" && query.sources?.length) {
    const wanted = (query.sources.includes("students") && row.studentReports > 0) ||
      (query.sources.includes("imported") && (row.historicalReports > 0));
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
  const requestedPage = query.page !== undefined && Number.isSafeInteger(query.page) && query.page > 0
    ? query.page
    : 1;
  const pageSize = query.pageSize !== undefined && Number.isSafeInteger(query.pageSize)
    ? Math.min(100, Math.max(5, query.pageSize))
    : DEFAULT_PAGE_SIZE;

  const [all, tiers] = await Promise.all([
    loadRows(query.batchYear),
    getTierConfigs(query.batchYear),
  ]);

  const rows = all.filter((row) => matches(row, query));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount);

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
  const sourceCounts = countBy("sources", (row) => [
    ...(row.studentReports > 0 ? ["students"] : []),
    ...(row.historicalReports > 0 ? ["imported"] : []),
  ]);

  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    pageCount,
    reportedRows: rows.filter((row) => row.studentReports > 0).length,
    facets: {
      tiers: tiers.map((tier) => ({
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
