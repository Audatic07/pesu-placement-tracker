import "server-only";
import { prisma } from "@/lib/db";

/**
 * The live observation layer.
 *
 * Every statistic this application shows about a batch is built from student
 * submissions, and from nothing else. One submission is one person: their
 * package, their branch, their CGPA, the rounds they actually sat.
 *
 * This file used to union submissions with the rows imported from the placement
 * spreadsheets, and every aggregate averaged across both. That conflated two
 * quantities that are not the same thing — a company ADVERTISED 60 LPA, and a
 * student RECEIVED 60 LPA — and it meant the headline numbers for a live batch
 * were mostly a restatement of a spreadsheet nobody is maintaining any more.
 *
 * The imported layer is now history and is read only where history is the
 * point: `getCompanyHistory` below, which the company profile uses to show what
 * a recruiter did in previous years. It never reaches an aggregate. A batch
 * with no submissions reports honest emptiness rather than a borrowed number.
 */

export type Observation = {
  offerId: string;
  companyId: string;
  companyName: string;
  companySlug: string;

  cycle: string;
  tierKey: string | null;
  roleFamily: string;
  roleTitle: string;

  ctcLpa: number | null;
  baseLpa: number | null;
  stipendInr: number | null;
  firstYearCashLpa: number | null;
  nonCashLpa: number;

  /** The branch of the student who got it. */
  branchCode: string | null;
  /** Branches this student reported the company as having called for. */
  eligibleBranches: string[];
  /** The CGPA bar the company announced, as this student heard it. */
  announcedCgpaCutoff: number | null;

  workMode: string;
  bondMonths: number | null;
  internshipDurationMonths: number | null;

  verification: string;
  /** Offer date where given, else the earliest round, else when it was filed. */
  date: Date | null;
};

export type ObservationFilters = {
  batchYear: number;
  cycle?: string;
  tierKey?: string;
  companyId?: string;
  roleFamily?: string;
  branchCode?: string;
};

const nonCashOf = (
  components: Array<{ amount: unknown; isCash: boolean; isLpa: boolean; currency: string }>,
) =>
  components
    .filter((component) => !component.isCash && component.isLpa && component.currency === "INR")
    .reduce((sum, component) => sum + Number(component.amount), 0);

const decimal = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export async function loadObservations(
  filters: ObservationFilters,
): Promise<Observation[]> {
  const offers = await prisma.offer.findMany({
    where: {
      batch: { year: filters.batchYear },
      deletedAt: null,
      verification: { not: "REMOVED" },
      ...(filters.cycle ? { cycle: filters.cycle as never } : {}),
      ...(filters.tierKey ? { tierKey: filters.tierKey } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.roleFamily ? { roleFamily: filters.roleFamily as never } : {}),
      ...(filters.branchCode ? { branch: { code: filters.branchCode } } : {}),
    },
    select: {
      id: true,
      roleTitle: true,
      roleFamily: true,
      cycle: true,
      tierKey: true,
      offerDate: true,
      createdAt: true,
      verification: true,
      workMode: true,
      bondMonths: true,
      internshipDurationMonths: true,
      announcedCgpaCutoff: true,
      eligibleBranches: true,
      company: { select: { id: true, name: true, slug: true } },
      branch: { select: { code: true } },
      rounds: { select: { heldOn: true }, orderBy: { sequence: "asc" } },
      compensation: {
        select: {
          ctcLpa: true,
          baseLpa: true,
          stipendPerMonthInr: true,
          firstYearCashLpa: true,
          components: { select: { amount: true, isCash: true, isLpa: true, currency: true } },
        },
      },
    },
  });

  return offers.map((offer) => {
    const pkg = offer.compensation;
    // A student who gave round dates but no offer date has still told us when
    // their season happened; the first round is the honest stamp for it.
    const firstRound = offer.rounds.map((round) => round.heldOn).find(Boolean) ?? null;

    return {
      offerId: offer.id,
      companyId: offer.company.id,
      companyName: offer.company.name,
      companySlug: offer.company.slug,
      cycle: offer.cycle,
      tierKey: offer.tierKey,
      roleFamily: offer.roleFamily,
      roleTitle: offer.roleTitle,
      ctcLpa: decimal(pkg?.ctcLpa),
      baseLpa: decimal(pkg?.baseLpa),
      stipendInr: decimal(pkg?.stipendPerMonthInr),
      firstYearCashLpa: decimal(pkg?.firstYearCashLpa),
      nonCashLpa: pkg ? nonCashOf(pkg.components) : 0,
      branchCode: offer.branch?.code ?? null,
      eligibleBranches: offer.eligibleBranches,
      announcedCgpaCutoff: decimal(offer.announcedCgpaCutoff),
      workMode: offer.workMode,
      bondMonths: offer.bondMonths,
      internshipDurationMonths: offer.internshipDurationMonths,
      verification: offer.verification,
      date: offer.offerDate ?? firstRound ?? offer.createdAt,
    };
  });
}

export type HistoricalPoint = {
  batchYear: number;
  cycle: string;
  status: string;
  studentsPlaced: number;
  highestCtcLpa: number | null;
  gpaCutoffRaw: string | null;
};

/**
 * The imported spreadsheet layer, read as history and only as history.
 *
 * These rows carry a headcount rather than a person — the 2026 sheet records
 * that IBM placed 88 students, not who they were — which is exactly why they
 * cannot be mixed into anything above. Kept because a recruiter's behaviour in
 * previous years is real context a first submission cannot supply.
 */
export async function getCompanyHistory(companyId: string): Promise<HistoricalPoint[]> {
  const drives = await prisma.drive.findMany({
    where: { companyId },
    select: {
      cycle: true,
      status: true,
      gpaCutoffRaw: true,
      batch: { select: { year: true } },
      roles: {
        select: {
          placedInternship: true,
          placedFte: true,
          placedBoth: true,
          compensation: { select: { id: true, ctcLpa: true } },
        },
      },
    },
    orderBy: [{ batch: { year: "asc" } }, { visitNumber: "asc" }],
  });

  return drives.map((drive) => {
    // Roles sharing one merged cell in the source describe ONE package; count
    // it once or a company advertising the same figure for three roles looks
    // like three offers.
    const byPackage = new Map<string, number>();
    for (const role of drive.roles) {
      if (role.compensation?.ctcLpa) {
        byPackage.set(role.compensation.id, Number(role.compensation.ctcLpa));
      }
    }
    const values = [...byPackage.values()];

    return {
      batchYear: drive.batch.year,
      cycle: drive.cycle,
      status: drive.status,
      studentsPlaced: drive.roles.reduce(
        (sum, role) =>
          sum + (role.placedInternship ?? 0) + (role.placedFte ?? 0) + (role.placedBoth ?? 0),
        0,
      ),
      highestCtcLpa: values.length ? Math.max(...values) : null,
      gpaCutoffRaw: drive.gpaCutoffRaw,
    };
  });
}
