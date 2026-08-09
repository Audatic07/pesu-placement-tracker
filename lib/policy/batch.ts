import "server-only";
import { prisma } from "@/lib/db";
import type { BatchModel } from "@/generated/prisma/models";

/**
 * Batch provisioning.
 *
 * A student from the class of 2033 must be able to log in and record an offer
 * without anyone having remembered, seven years earlier, to create a row for
 * their year. So the first login from an unseen batch creates it, seeded from
 * the most recent batch's tier boundaries and submission policy.
 *
 * Inheriting from the previous batch rather than from constants is the point:
 * when an admin adjusts tier thresholds in 2031, every batch created
 * afterwards starts from the adjusted values instead of from whatever was true
 * when this file was written.
 */

/** Fallbacks used only when the database contains no batches at all. */
const BOOTSTRAP_TIERS = [
  { key: "TIER_1", label: "Tier 1", rank: 1, minCtcLpa: 12, maxCtcLpa: null },
  { key: "TIER_2", label: "Tier 2", rank: 2, minCtcLpa: 6, maxCtcLpa: 12 },
  { key: "TIER_3", label: "Tier 3", rank: 3, minCtcLpa: 0, maxCtcLpa: 6 },
];

export async function ensureBatch(year: number): Promise<BatchModel> {
  const existing = await prisma.batch.findUnique({ where: { year } });
  if (existing) return existing;

  const template = await prisma.batch.findFirst({
    orderBy: { year: "desc" },
    include: { tierConfigs: true, submissionRule: true },
  });

  const tiers = template?.tierConfigs.length
    ? template.tierConfigs.map((tier) => ({
        key: tier.key,
        label: tier.label,
        rank: tier.rank,
        minCtcLpa: tier.minCtcLpa,
        maxCtcLpa: tier.maxCtcLpa,
      }))
    : BOOTSTRAP_TIERS;

  const policy = template?.submissionRule;

  return prisma.batch.create({
    data: {
      year,
      // Seasons have opened on 1 August of the preceding year for as long as
      // the source sheets record. Adjustable from the admin console.
      seasonStartsAt: new Date(Date.UTC(year - 1, 7, 1)),
      tierConfigs: { create: tiers },
      submissionRule: {
        create: {
          maxSummerInternships: policy?.maxSummerInternships ?? 1,
          maxSixMonthInternships: policy?.maxSixMonthInternships ?? 3,
          maxFullTimePerTier: policy?.maxFullTimePerTier ?? 1,
          maxFullTimeTotal: policy?.maxFullTimeTotal ?? 3,
          description: policy?.description ?? null,
        },
      },
    },
  });
}

/**
 * Resolves a CTC to a tier key using the boundaries in force for that batch.
 *
 * Bounds are inclusive-lower, exclusive-upper. Returns null when the package
 * is undisclosed — which is not a gap in the data but a real category, and the
 * reason the 2026 workbook needed a separate "Internship Only" tab.
 */
export async function resolveTierKey(
  batchId: string,
  ctcLpa: number | null | undefined,
): Promise<string | null> {
  if (ctcLpa === null || ctcLpa === undefined || !Number.isFinite(ctcLpa)) {
    return null;
  }

  const tiers = await prisma.tierConfig.findMany({
    where: { batchId },
    orderBy: { rank: "asc" },
  });

  for (const tier of tiers) {
    const min = Number(tier.minCtcLpa);
    const max = tier.maxCtcLpa === null ? Infinity : Number(tier.maxCtcLpa);
    if (ctcLpa >= min && ctcLpa < max) return tier.key;
  }

  return null;
}
