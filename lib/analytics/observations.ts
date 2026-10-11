import type { RecordSource, AcceptanceStatus, OfferNature, WorkMode, OfferCycle, RoleFamily } from "@/generated/prisma/enums";
import "server-only";
import { cache } from "react";
import { cacheBatchRead } from "./cache";
import { prisma } from "@/lib/db";

/** Each row represents an offer outcome; historical headcounts have no owning student. */

export type Observation = {
  offerId: string;
  companyId: string;
  companyName: string;
  companySlug: string;

  source: RecordSource;
  acceptanceStatus: AcceptanceStatus;
  nature: OfferNature;
  cycle: OfferCycle;
  tierKey: string | null;
  roleFamily: RoleFamily;
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

  workMode: WorkMode;
  bondMonths: number | null;
  internshipDurationMonths: number | null;

  verification: string;
  /** Offer date where given, else the earliest round, else when it was filed. */
  date: Date | null;
};

export type ObservationFilters = {
  batchYear: number;
  cycle?: OfferCycle;
  tierKey?: string;
  companyId?: string;
  roleFamily?: RoleFamily;
  branchCode?: string;
};

const nonCashOf = (
  components: Array<{ amount: unknown; isCash: boolean; isLpa: boolean; currency: string; vestingYears: unknown }>,
) =>
  components
    .filter((component) => !component.isCash && component.currency === "INR")
    .reduce((sum, component) => sum + (component.isLpa ? Number(component.amount)
      : component.vestingYears !== null && Number(component.vestingYears) > 0
        ? Number(component.amount) / 100_000 / Number(component.vestingYears) : 0), 0);

const decimal = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

type StoredObservation = Omit<Observation, "date"> & { date: string | null };

async function readBatchObservations(batchYear: number): Promise<StoredObservation[]> {
  const offers = await prisma.offer.findMany({
    where: {
      batch: { year: batchYear },
      deletedAt: null,
      verification: { not: "REMOVED" },

    },
    select: {
      id: true,
      roleTitle: true,
      roleFamily: true,
      acceptanceStatus: true,
      nature: true,
      cycle: true,
      tierKey: true,
      offerDate: true,
      createdAt: true,
      verification: true,
      source: true,
      workMode: true,
      bondMonths: true,
      internshipDurationMonths: true,
      announcedCgpaCutoff: true,
      eligibleBranches: true,
      company: { select: { id: true, name: true, slug: true } },
      branch: { select: { code: true } },
      rounds: { where: { heldOn: { not: null } }, select: { heldOn: true }, orderBy: { heldOn: "asc" }, take: 1 },
      compensation: {
        select: {
          ctcLpa: true,
          baseLpa: true,
          stipendPerMonthInr: true,
          firstYearCashLpa: true,
          components: { select: { amount: true, isCash: true, isLpa: true, currency: true, vestingYears: true } },
        },
      },
    },
  });

  return offers.map((offer) => {
    const pkg = offer.compensation;
    const firstRound = offer.rounds[0]?.heldOn ?? null;

    return {
      offerId: offer.id,
      companyId: offer.company.id,
      companyName: offer.company.name,
      companySlug: offer.company.slug,
      source: offer.source,
      acceptanceStatus: offer.acceptanceStatus,
      nature: offer.nature,
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
      date: (offer.offerDate ?? firstRound ?? (offer.source === "OFFICIAL_IMPORT" ? null : offer.createdAt))?.toISOString() ?? null,
    };
  });
}

const readStoredBatch = cacheBatchRead("offer-observations-v4", readBatchObservations);
const loadBatch = cache(async (year: number): Promise<Observation[]> =>
  (await readStoredBatch(year)).map((row) => Object.assign({}, row, {
    date: row.date ? new Date(row.date) : null,
  })),
);

export async function loadObservations(filters: ObservationFilters): Promise<Observation[]> {
  const rows = await loadBatch(filters.batchYear);
  return rows.filter((row) =>
    (!filters.cycle || row.cycle === filters.cycle) &&
    (!filters.tierKey || row.tierKey === filters.tierKey) &&
    (!filters.companyId || row.companyId === filters.companyId) &&
    (!filters.roleFamily || row.roleFamily === filters.roleFamily) &&
    (!filters.branchCode || row.branchCode === filters.branchCode),
  );
}
