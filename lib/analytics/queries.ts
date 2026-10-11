import type { OfferCycle, WorkMode } from "@/generated/prisma/enums";
import "server-only";
import { computeOutlook, type CgpaOutlook } from "./outlook";
import { prisma } from "@/lib/db";
import { cacheBatchRead } from "./cache";
import { getTierConfigs } from "./config";
import { gate, type Suppressible } from "@/lib/privacy/gate";
import {
  loadObservations,
  type Observation,
  type ObservationFilters,
} from "./observations";
import { histogram, median, packageStats, type Bucket, type PackageStats } from "./stats";

/** Offer aggregates include labelled historical records. Personal statistics respect the privacy floor. */

export type AnalyticsFilters = ObservationFilters;

function summarise(
  observations: Observation[],
  pick: (observation: Observation) => number | null,
): PackageStats {
  const values = observations
    .map(pick)
    .filter((value): value is number => value !== null);

  const result = gate(values.length, () => packageStats(values));
  return result.suppressed
    ? { ...packageStats([]), count: values.length }
    : result.value;
}

export type TermsBreakdown = {
  workMode: Array<{ key: WorkMode; count: number }>;
  withBond: number;
  medianBondMonths: number | null;
  medianInternshipMonths: number | null;
};

export type BatchOverview = {
  batchYear: number;
  /** Submissions behind every figure on this object. */
  reportCount: number;
  historicalCount: number;
  unknownAcceptance: number;
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

function gatedStatistic(values: number[], compute: (values: number[]) => number | null): number | null {
  const result = gate(values.length, () => compute(values));
  return result.suppressed ? null : result.value;
}

function termsOf(observations: Observation[]): TermsBreakdown {
  const modes = new Map<WorkMode, number>();
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
    medianBondMonths: gatedStatistic(bonds, median),
    medianInternshipMonths: gatedStatistic(internships, median),
  };
}

async function readBatchOverview(
  filters: AnalyticsFilters,
): Promise<BatchOverview | null> {
  const batch = await prisma.batch.findUnique({ where: { year: filters.batchYear }, select: { id: true } });
  if (!batch) return null;

  const observations = await loadObservations(filters);

  const countWhere = (predicate: (row: Observation) => boolean) =>
    observations.filter(predicate).length;

  const ctcValues = observations
    .map((observation) => observation.ctcLpa)
    .filter((value): value is number => value !== null);

  const distribution = gate(ctcValues.length, () => histogram(ctcValues, 5));

  return {
    batchYear: filters.batchYear,
    reportCount: observations.length,
    historicalCount: observations.filter((row) => row.source === "OFFICIAL_IMPORT").length,
    unknownAcceptance: countWhere((row) => row.acceptanceStatus === "UNKNOWN"),
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
    ctcHistogram: distribution.suppressed ? [] : distribution.value,
    terms: termsOf(observations),
  };
}

const loadOverview = cacheBatchRead("batch-overview-v1", (year) => readBatchOverview({ batchYear: year }));

export function getBatchOverview(filters: AnalyticsFilters): Promise<BatchOverview | null> {
  return Object.entries(filters).some(([key, value]) => key !== "batchYear" && value !== undefined)
    ? readBatchOverview(filters) : loadOverview(filters.batchYear);
}

export type TierBreakdown = {
  tierKey: string;
  label: string;
  rank: number;
  companies: number;
  reports: number;
  ctc: PackageStats;
};

async function readTierBreakdown(
  batchYear: number,
  filters: Omit<AnalyticsFilters, "batchYear" | "tierKey"> = {},
): Promise<TierBreakdown[]> {
  const [tiers, all] = await Promise.all([
    getTierConfigs(batchYear),
    loadObservations({ ...filters, batchYear }),
  ]);
  return tiers.map((tier) => {
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

const loadTierBreakdown = cacheBatchRead("tier-breakdown-v1", (year) => readTierBreakdown(year));

export function getTierBreakdown(
  year: number, filters: Omit<AnalyticsFilters, "batchYear" | "tierKey"> = {},
): Promise<TierBreakdown[]> {
  return Object.values(filters).some((value) => value !== undefined)
    ? readTierBreakdown(year, filters) : loadTierBreakdown(year);
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
export const getBranchBreakdown = cacheBatchRead("branch-breakdown-v1", async (batchYear: number): Promise<BranchBreakdown[]> => {
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
});

export type RecruiterRow = {
  companyName: string;
  companySlug: string;
  reports: number;
  highestCtc: number | null;
  medianCtc: number | null;
  tierKeys: string[];
};

async function readRecruiters(batchYear: number): Promise<RecruiterRow[]> {
  const all = await loadObservations({ batchYear });
  const byCompany = new Map<string, Observation[]>();

  for (const observation of all) {
    const bucket = byCompany.get(observation.companySlug);
    if (bucket) bucket.push(observation);
    else byCompany.set(observation.companySlug, [observation]);
  }

  return [...byCompany.values()]
    .map((group) => {
      const ctc = summarise(group, (row) => row.ctcLpa);
      return {
        companyName: group[0]!.companyName,
        companySlug: group[0]!.companySlug,
        reports: group.length,
        highestCtc: ctc.highest,
        medianCtc: ctc.median,
        tierKeys: [
          ...new Set(
            group.map((observation) => observation.tierKey).filter((key): key is string => !!key),
          ),
        ],
      };
    })
    .sort((a, b) => b.reports - a.reports || (b.highestCtc ?? 0) - (a.highestCtc ?? 0));
}

const loadRecruiters = cacheBatchRead("recruiter-aggregates-v1", readRecruiters);
export async function getTopRecruiters(year: number, limit = 12): Promise<RecruiterRow[]> {
  return (await loadRecruiters(year)).slice(0, limit);
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
export const getAnnouncedCutoffs = cacheBatchRead("announced-cutoffs-v1", async (batchYear: number): Promise<CutoffRow[]> => {
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
        lowestReportedCgpa: gatedStatistic(cgpas, (values) => Math.min(...values)),
      };
    })
    .sort((a, b) => b.announcedCgpaCutoff - a.announcedCgpaCutoff);
});

export type CtcInflationRow = {
  key: string;
  companyName: string;
  companySlug: string;
  ctcLpa: number;
  firstYearCashLpa: number | null;
  ratio: number | null;
  nonCashLpa: number;
};

async function readCtcInflation(batchYear: number): Promise<CtcInflationRow[]> {
  const all = await loadObservations({ batchYear });

  const grouped = new Map<string, Observation[]>();
  for (const row of all) {
    if (row.ctcLpa === null) continue;
    const group = grouped.get(row.companySlug);
    if (group) group.push(row);
    else grouped.set(row.companySlug, [row]);
  }

  return [...grouped.values()].flatMap((group) => {
    const ctc = summarise(group, (row) => row.ctcLpa).median;
    if (ctc === null) return [];
    const cash = summarise(group, (row) => row.firstYearCashLpa).median;
    const nonCash = gatedStatistic(group.map((row) => row.nonCashLpa), median) ?? 0;
    const ratios = group.flatMap((row) =>
      row.firstYearCashLpa !== null && row.firstYearCashLpa > 0
        ? [row.ctcLpa! / row.firstYearCashLpa]
        : [],
    );
    const ratio = gatedStatistic(ratios, median);
    if (nonCash <= 0 && (ratio === null || ratio <= 1.05)) return [];
    return [{
      key: group[0]!.companySlug,
      companyName: group[0]!.companyName,
      companySlug: group[0]!.companySlug,
      ctcLpa: ctc,
      firstYearCashLpa: cash,
      ratio,
      nonCashLpa: nonCash,
    }];
  }).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.nonCashLpa - a.nonCashLpa);
}

const loadCtcInflation = cacheBatchRead("ctc-inflation-v1", readCtcInflation);
export async function getCtcInflationLeaders(year: number, limit = 20): Promise<CtcInflationRow[]> {
  return (await loadCtcInflation(year)).slice(0, limit);
}

export type SeasonEntry = {
  id: string;
  date: number | null;
  company: { name: string; slug: string };
  reports: number;
  roleTitles: string[];
  tierKeys: string[];
  highestCtc: number | null;
  highestStipend: number | null;
};

export const getSeasonEntries = cacheBatchRead("season-entries-v1", async (year): Promise<SeasonEntry[]> => {
  const byCompany = new Map<string, Observation[]>();
  for (const offer of await loadObservations({ batchYear: year })) {
    const key = `${offer.companyId}::${offer.cycle}`;
    const group = byCompany.get(key);
    if (group) group.push(offer);
    else byCompany.set(key, [offer]);
  }
  return [...byCompany.entries()].map(([id, group]) => {
    const dates = group.flatMap((row) => row.date ? [row.date.getTime()] : []);
    const ctcs = group.flatMap((row) => row.ctcLpa === null ? [] : [row.ctcLpa]);
    const stipends = group.flatMap((row) => row.stipendInr === null ? [] : [row.stipendInr]);
    return {
      id, date: dates.length ? Math.min(...dates) : null,
      company: { name: group[0]!.companyName, slug: group[0]!.companySlug },
      reports: group.length,
      roleTitles: [...new Set(group.map((row) => row.roleTitle).filter(Boolean))],
      tierKeys: [...new Set(group.flatMap((row) => row.tierKey ? [row.tierKey] : []))],
      highestCtc: gatedStatistic(ctcs, (values) => Math.max(...values)),
      highestStipend: gatedStatistic(stipends, (values) => Math.max(...values)),
    };
  });
});

export type CompanyTrendPoint = {
  key: string;
  batchYear: number;
  cycle: OfferCycle;
  offers: number;
  highestCtc: number | null;
  medianCtc: number | null;
  gpaCutoff: string | null;
};

/** Historical and student submissions share one company/season aggregate. */
export async function getCompanyTrend(companyId: string): Promise<CompanyTrendPoint[]> {
  const offers = await prisma.offer.findMany({
    where: { companyId, deletedAt: null, verification: { not: "REMOVED" } },
    select: {
      cycle: true,
      announcedCgpaCutoff: true,
      batch: { select: { year: true } },
      compensation: { select: { ctcLpa: true } },
    },
  });
  const grouped = new Map<string, typeof offers>();
  for (const offer of offers) {
    const key = `${offer.batch.year}::${offer.cycle}`;
    const group = grouped.get(key);
    if (group) group.push(offer);
    else grouped.set(key, [offer]);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const first = group[0]!;
    const values = group.flatMap((offer) => offer.compensation?.ctcLpa == null ? [] : [Number(offer.compensation.ctcLpa)]);
    const cutoffs = group.flatMap((offer) => offer.announcedCgpaCutoff === null ? [] : [Number(offer.announcedCgpaCutoff)]);
    const stats = gate(values.length, () => packageStats(values));
    const cutoff = median(cutoffs);
    return {
      key, batchYear: first.batch.year, cycle: first.cycle, offers: group.length,
      highestCtc: stats.suppressed ? null : stats.value.highest,
      medianCtc: stats.suppressed ? null : stats.value.median,
      gpaCutoff: cutoff === null ? null : cutoff.toFixed(2),
    };
  }).sort((a, b) => a.batchYear - b.batchYear || a.cycle.localeCompare(b.cycle));
}

/**
 * CGPA against package, from submissions.
 *
 * Gated: a scatter plot is a list of individuals wearing a disguise.
 */
export const getCgpaVersusPackage = cacheBatchRead("cgpa-packages-v1", async (
  batchYear: number,
): Promise<Suppressible<Array<{ cgpa: number; ctcLpa: number }>>> => {
  const offers = await prisma.offer.findMany({
    where: {
      batch: { year: batchYear },
      deletedAt: null,
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
});

export async function getCgpaOutlook(batchYear: number, cgpa: number): Promise<CgpaOutlook> {
  const [tiers, bars, offers] = await Promise.all([
    getTierConfigs(batchYear),
    getAnnouncedCutoffs(batchYear),
    prisma.offer.findMany({
      where: {
        batch: { year: batchYear },
        deletedAt: null,
        verification: { notIn: ["DISPUTED", "REMOVED"] },
        cgpa: { not: null },
        compensation: { ctcLpa: { not: null } },
      },
      select: { cgpa: true, tierKey: true, compensation: { select: { ctcLpa: true } } },
    }),
  ]);
  return computeOutlook(cgpa, bars, offers.flatMap((offer) =>
    offer.cgpa === null || offer.compensation?.ctcLpa == null ? [] : [{
      cgpa: Number(offer.cgpa),
      ctcLpa: Number(offer.compensation.ctcLpa),
      tierKey: offer.tierKey,
    }]), tiers);
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
