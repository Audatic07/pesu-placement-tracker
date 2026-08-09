import "server-only";
import { prisma } from "@/lib/db";
import { gate, type Suppressible } from "@/lib/privacy/gate";
import {
  getCompanyHistory,
  loadObservations,
  type HistoricalPoint,
  type Observation,
  type ObservationFilters,
} from "./observations";
import { histogram, mean, median, percentile, standardDeviation, type Bucket } from "./stats";

/**
 * The aggregation layer.
 *
 * Everything here reads student submissions and only student submissions. The
 * imported spreadsheets seeded the company list and give a recruiter's previous
 * years context on its own profile; they are never averaged into a figure about
 * how a batch is doing. See lib/analytics/observations for why.
 *
 * The practical consequence is that a figure can be honestly thin. Every result
 * carries the number of reports behind it so a page can say "from 4 reports"
 * rather than presenting four people as a batch. Anything derived from
 * individuals also passes through the privacy gate.
 */

export type PackageStats = {
  count: number;
  highest: number | null;
  average: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  standardDeviation: number | null;
};

export type AnalyticsFilters = ObservationFilters;

function summarise(
  observations: Observation[],
  pick: (observation: Observation) => number | null,
): PackageStats {
  const values = observations
    .map(pick)
    .filter((value): value is number => value !== null);

  return {
    count: values.length,
    highest: values.length ? Math.max(...values) : null,
    average: mean(values),
    median: median(values),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    standardDeviation: standardDeviation(values),
  };
}

export type TermsBreakdown = {
  workMode: Array<{ key: string; count: number }>;
  withBond: number;
  medianBondMonths: number | null;
  medianInternshipMonths: number | null;
};

export type BatchOverview = {
  batchYear: number;
  /** Submissions behind every figure on this object. */
  reportCount: number;
  companiesReported: number;
  accepted: number;
  declined: number;
  undecided: number;
  internshipOnly: number;
  fteOnly: number;
  converted: number;
  ctc: PackageStats;
  base: PackageStats;
  stipend: PackageStats;
  ctcHistogram: Bucket[];
  terms: TermsBreakdown;
};

function termsOf(observations: Observation[]): TermsBreakdown {
  const modes = new Map<string, number>();
  for (const observation of observations) {
    if (observation.workMode === "UNKNOWN") continue;
    modes.set(observation.workMode, (modes.get(observation.workMode) ?? 0) + 1);
  }

  const bonds = observations
    .map((observation) => observation.bondMonths)
    .filter((value): value is number => value !== null && value > 0);
  const internships = observations
    .map((observation) => observation.internshipDurationMonths)
    .filter((value): value is number => value !== null && value > 0);

  return {
    workMode: [...modes.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    withBond: bonds.length,
    medianBondMonths: median(bonds),
    medianInternshipMonths: median(internships),
  };
}

export async function getBatchOverview(
  filters: AnalyticsFilters,
): Promise<BatchOverview | null> {
  const batch = await prisma.batch.findUnique({ where: { year: filters.batchYear } });
  if (!batch) return null;

  const observations = await loadObservations(filters);

  const acceptance = await prisma.offer.groupBy({
    by: ["acceptanceStatus", "nature"],
    where: {
      batchId: batch.id,
      deletedAt: null,
      verification: { not: "REMOVED" },
      ...(filters.cycle ? { cycle: filters.cycle as never } : {}),
      ...(filters.tierKey ? { tierKey: filters.tierKey } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.branchCode ? { branch: { code: filters.branchCode } } : {}),
    },
    _count: { _all: true },
  });

  const countWhere = (predicate: (row: (typeof acceptance)[number]) => boolean) =>
    acceptance.filter(predicate).reduce((sum, row) => sum + row._count._all, 0);

  const ctcValues = observations
    .map((observation) => observation.ctcLpa)
    .filter((value): value is number => value !== null);

  return {
    batchYear: filters.batchYear,
    reportCount: observations.length,
    companiesReported: new Set(observations.map((observation) => observation.companyId)).size,
    accepted: countWhere((row) => row.acceptanceStatus === "ACCEPTED"),
    declined: countWhere((row) => row.acceptanceStatus === "DECLINED"),
    undecided: countWhere((row) => row.acceptanceStatus === "PENDING"),
    internshipOnly: countWhere((row) => row.nature === "INTERNSHIP_ONLY"),
    fteOnly: countWhere((row) => row.nature === "FTE_ONLY"),
    converted: countWhere(
      (row) => row.nature === "INTERNSHIP_PLUS_FTE" || row.nature === "PPO_CONVERTED",
    ),
    ctc: summarise(observations, (observation) => observation.ctcLpa),
    base: summarise(observations, (observation) => observation.baseLpa),
    stipend: summarise(observations, (observation) => observation.stipendInr),
    ctcHistogram: histogram(ctcValues, 5),
    terms: termsOf(observations),
  };
}

export type TierBreakdown = {
  tierKey: string;
  label: string;
  rank: number;
  companies: number;
  reports: number;
  ctc: PackageStats;
};

export async function getTierBreakdown(
  batchYear: number,
  filters: Omit<AnalyticsFilters, "batchYear" | "tierKey"> = {},
): Promise<TierBreakdown[]> {
  const batch = await prisma.batch.findUnique({
    where: { year: batchYear },
    include: { tierConfigs: { orderBy: { rank: "asc" } } },
  });
  if (!batch) return [];

  const all = await loadObservations({ ...filters, batchYear });

  return batch.tierConfigs.map((tier) => {
    const inTier = all.filter((observation) => observation.tierKey === tier.key);
    return {
      tierKey: tier.key,
      label: tier.label,
      rank: tier.rank,
      companies: new Set(inTier.map((observation) => observation.companyId)).size,
      reports: inTier.length,
      ctc: summarise(inTier, (observation) => observation.ctcLpa),
    };
  });
}

export type BranchBreakdown = {
  branchCode: string;
  branchName: string;
  /** Distinct companies students reported as calling for this branch. */
  companiesOpenTo: number;
  /** Offers reported by students OF this branch. */
  offersReported: number;
  ctc: PackageStats;
};

/**
 * Eligibility and outcome are different questions, and submissions answer both
 * separately: `eligibleBranches` is what the company said it wanted, `branch`
 * is who actually got it. Reporting them side by side is what shows a branch
 * being invited to plenty of drives and converting almost none of them.
 */
export async function getBranchBreakdown(batchYear: number): Promise<BranchBreakdown[]> {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
  });
  const all = await loadObservations({ batchYear });

  return branches.map((branch) => {
    const openTo = all.filter((observation) =>
      observation.eligibleBranches.includes(branch.code),
    );
    const received = all.filter((observation) => observation.branchCode === branch.code);

    return {
      branchCode: branch.code,
      branchName: branch.name,
      companiesOpenTo: new Set(openTo.map((observation) => observation.companyId)).size,
      offersReported: received.length,
      ctc: summarise(received, (observation) => observation.ctcLpa),
    };
  });
}

export type RecruiterRow = {
  companyName: string;
  companySlug: string;
  reports: number;
  highestCtc: number | null;
  medianCtc: number | null;
  tierKeys: string[];
};

export async function getTopRecruiters(
  batchYear: number,
  limit = 12,
): Promise<RecruiterRow[]> {
  const all = await loadObservations({ batchYear });
  const byCompany = new Map<string, Observation[]>();

  for (const observation of all) {
    const bucket = byCompany.get(observation.companySlug);
    if (bucket) bucket.push(observation);
    else byCompany.set(observation.companySlug, [observation]);
  }

  return [...byCompany.values()]
    .map((group) => {
      const ctcValues = group
        .map((observation) => observation.ctcLpa)
        .filter((value): value is number => value !== null);
      return {
        companyName: group[0]!.companyName,
        companySlug: group[0]!.companySlug,
        reports: group.length,
        highestCtc: ctcValues.length ? Math.max(...ctcValues) : null,
        medianCtc: median(ctcValues),
        tierKeys: [
          ...new Set(
            group.map((observation) => observation.tierKey).filter((key): key is string => !!key),
          ),
        ],
      };
    })
    .sort((a, b) => b.reports - a.reports || (b.highestCtc ?? 0) - (a.highestCtc ?? 0))
    .slice(0, limit);
}

export type CutoffRow = {
  companyName: string;
  companySlug: string;
  announcedCgpaCutoff: number;
  reports: number;
  lowestReportedCgpa: number | null;
};

/**
 * The CGPA bar companies announced, as students heard it.
 *
 * Gated per company rather than in aggregate: a cutoff sitting beside "reported
 * by 1 student" alongside that student's own CGPA is a fingerprint. Only the
 * announced figure and a count are returned; the lowest CGPA that still got an
 * offer appears once enough people have reported it to stop being one person.
 */
export async function getAnnouncedCutoffs(batchYear: number): Promise<CutoffRow[]> {
  const offers = await prisma.offer.findMany({
    where: {
      batch: { year: batchYear },
      deletedAt: null,
      verification: { not: "REMOVED" },
      announcedCgpaCutoff: { not: null },
    },
    select: {
      cgpa: true,
      announcedCgpaCutoff: true,
      company: { select: { name: true, slug: true } },
    },
  });

  const byCompany = new Map<string, typeof offers>();
  for (const offer of offers) {
    const bucket = byCompany.get(offer.company.slug);
    if (bucket) bucket.push(offer);
    else byCompany.set(offer.company.slug, [offer]);
  }

  return [...byCompany.values()]
    .map((group) => {
      const cutoffs = group.map((offer) => Number(offer.announcedCgpaCutoff)).sort((a, b) => a - b);
      const cgpas = group
        .map((offer) => (offer.cgpa === null ? null : Number(offer.cgpa)))
        .filter((value): value is number => value !== null);

      return {
        companyName: group[0]!.company.name,
        companySlug: group[0]!.company.slug,
        // Where students disagree on what was announced, the median is the
        // least wrong single answer and does not let one mishearing lead.
        announcedCgpaCutoff: median(cutoffs)!,
        reports: group.length,
        lowestReportedCgpa: cgpas.length >= 3 ? Math.min(...cgpas) : null,
      };
    })
    .sort((a, b) => b.announcedCgpaCutoff - a.announcedCgpaCutoff);
}

export type CtcInflationRow = {
  key: string;
  companyName: string;
  companySlug: string;
  ctcLpa: number;
  firstYearCashLpa: number | null;
  ratio: number | null;
  nonCashLpa: number;
};

export async function getCtcInflationLeaders(
  batchYear: number,
  limit = 20,
): Promise<CtcInflationRow[]> {
  const all = await loadObservations({ batchYear });

  return all
    .filter((observation) => observation.ctcLpa !== null)
    .map((observation) => ({
      key: observation.offerId,
      companyName: observation.companyName,
      companySlug: observation.companySlug,
      ctcLpa: observation.ctcLpa!,
      firstYearCashLpa: observation.firstYearCashLpa,
      ratio:
        observation.firstYearCashLpa && observation.firstYearCashLpa > 0
          ? observation.ctcLpa! / observation.firstYearCashLpa
          : null,
      nonCashLpa: observation.nonCashLpa,
    }))
    .filter((row) => row.nonCashLpa > 0 || (row.ratio !== null && row.ratio > 1.05))
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.nonCashLpa - a.nonCashLpa)
    .slice(0, limit);
}

export type CompanyTrendPoint = {
  batchYear: number;
  cycle: string;
  status: string;
  studentsPlaced: number;
  highestCtc: number | null;
  medianCtc: number | null;
  gpaCutoff: string | null;
  source: "students" | "imported";
};

/**
 * Year over year for one company, in nominal rupees.
 *
 * The two layers are listed side by side and labelled, never summed: an
 * imported row is a headcount a spreadsheet published, a student row is people
 * who filed. Adding them would double-count every 2026 offer that a student
 * also reported here.
 */
export async function getCompanyTrend(companyId: string): Promise<CompanyTrendPoint[]> {
  const [history, offers] = await Promise.all([
    getCompanyHistory(companyId),
    prisma.offer.findMany({
      where: { companyId, deletedAt: null, verification: { not: "REMOVED" } },
      select: {
        cycle: true,
        announcedCgpaCutoff: true,
        batch: { select: { year: true } },
        compensation: { select: { ctcLpa: true } },
      },
    }),
  ]);

  const imported: CompanyTrendPoint[] = history.map((point: HistoricalPoint) => ({
    batchYear: point.batchYear,
    cycle: point.cycle,
    status: point.status,
    studentsPlaced: point.studentsPlaced,
    highestCtc: point.highestCtcLpa,
    medianCtc: null,
    gpaCutoff: point.gpaCutoffRaw,
    source: "imported",
  }));

  const grouped = new Map<string, typeof offers>();
  for (const offer of offers) {
    const key = `${offer.batch.year}::${offer.cycle}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(offer);
    else grouped.set(key, [offer]);
  }

  const reported: CompanyTrendPoint[] = [...grouped.entries()].map(([key, group]) => {
    const [yearText, cycle] = key.split("::");
    const values = group
      .map((offer) => (offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null))
      .filter((value): value is number => value !== null);
    const cutoffs = group
      .map((offer) => (offer.announcedCgpaCutoff === null ? null : Number(offer.announcedCgpaCutoff)))
      .filter((value): value is number => value !== null);
    const cutoff = median(cutoffs);

    return {
      batchYear: Number.parseInt(yearText ?? "", 10),
      cycle: cycle ?? "FULL_TIME",
      status: "COMPLETED",
      studentsPlaced: group.length,
      highestCtc: values.length ? Math.max(...values) : null,
      medianCtc: median(values),
      gpaCutoff: cutoff === null ? null : cutoff.toFixed(2),
      source: "students",
    };
  });

  return [...imported, ...reported].sort(
    (a, b) => a.batchYear - b.batchYear || a.source.localeCompare(b.source),
  );
}

/**
 * CGPA against package, from submissions.
 *
 * Gated: a scatter plot is a list of individuals wearing a disguise.
 */
export async function getCgpaVersusPackage(
  batchYear: number,
): Promise<Suppressible<Array<{ cgpa: number; ctcLpa: number }>>> {
  const offers = await prisma.offer.findMany({
    where: {
      batch: { year: batchYear },
      deletedAt: null,
      source: "SELF_REPORTED",
      verification: { notIn: ["DISPUTED", "REMOVED"] },
      cgpa: { not: null },
      compensation: { ctcLpa: { not: null } },
    },
    select: { cgpa: true, compensation: { select: { ctcLpa: true } } },
  });

  return gate(offers.length, () =>
    offers.map((offer) => ({
      cgpa: Number(offer.cgpa),
      ctcLpa: Number(offer.compensation!.ctcLpa),
    })),
  );
}

export type SeasonProgressPoint = { dayOffset: number; cumulativeOffers: number };

export async function getSeasonProgress(
  batchYear: number,
): Promise<SeasonProgressPoint[]> {
  const batch = await prisma.batch.findUnique({ where: { year: batchYear } });
  if (!batch?.seasonStartsAt) return [];

  const observations = (await loadObservations({ batchYear }))
    .filter((observation) => observation.date !== null)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());

  const start = batch.seasonStartsAt.getTime();
  const points: SeasonProgressPoint[] = [];
  let cumulative = 0;

  for (const observation of observations) {
    cumulative += 1;
    points.push({
      dayOffset: Math.round((observation.date!.getTime() - start) / 86_400_000),
      cumulativeOffers: cumulative,
    });
  }

  return points;
}
