import "server-only";
import { prisma } from "@/lib/db";
import type { OfferCycle } from "@/generated/prisma/enums";

/**
 * Submission quotas.
 *
 * Enforced on the server, always. The form hides options a student has used up,
 * but hiding is a courtesy — the check that matters runs inside the action,
 * because a hidden field is not a rule.
 *
 * The limits themselves are per-batch configuration, not constants: the source
 * sheets record a different official policy for 2026 than the one this product
 * uses, and both have to be expressible without a code change.
 */

export type QuotaSlot = {
  cycle: OfferCycle;
  label: string;
  used: number;
  max: number;
  remaining: number;
  /** Per-tier limits apply to full-time offers only. */
  perTier?: Array<{ tierKey: string; label: string; used: number; max: number }>;
};

/**
 * The best tier a student already holds, when the policy closes the tiers
 * below it. Carries the boundary so the form can say in rupees what would be
 * refused, rather than leaving the student to find out on submit.
 */
export type TierFloor = {
  tierKey: string;
  label: string;
  rank: number;
  minCtcLpa: number;
};

export type QuotaState = {
  batchId: string;
  batchYear: number;
  slots: QuotaSlot[];
  description: string | null;
  /** Null when the policy does not close lower tiers, or nothing tiered is held yet. */
  tierFloor: TierFloor | null;
};

export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const CYCLE_LABEL: Record<OfferCycle, string> = {
  SUMMER_INTERNSHIP: "Summer internship",
  SIX_MONTH_INTERNSHIP: "Internship",
  FULL_TIME: "Full-time offer",
};

export async function getQuotaState(
  studentId: string,
  batchYear: number,
): Promise<QuotaState | null> {
  const batch = await prisma.batch.findUnique({
    where: { year: batchYear },
    include: { submissionRule: true, tierConfigs: { orderBy: { rank: "asc" } } },
  });
  if (!batch?.submissionRule) return null;

  const policy = batch.submissionRule;
  const offers = await prisma.offer.findMany({
    where: { studentId, batchId: batch.id, deletedAt: null },
    select: { cycle: true, tierKey: true },
  });

  const countFor = (cycle: OfferCycle) =>
    offers.filter((offer) => offer.cycle === cycle).length;

  const fullTime = offers.filter((offer) => offer.cycle === "FULL_TIME");

  const floor = policy.closeLowerTiers ? bestTierHeld(offers, batch.tierConfigs) : null;

  return {
    batchId: batch.id,
    batchYear: batch.year,
    description: policy.description,
    tierFloor: floor
      ? {
          tierKey: floor.key,
          label: floor.label,
          rank: floor.rank,
          minCtcLpa: Number(floor.minCtcLpa),
        }
      : null,
    slots: [
      {
        cycle: "SUMMER_INTERNSHIP",
        label: CYCLE_LABEL.SUMMER_INTERNSHIP,
        used: countFor("SUMMER_INTERNSHIP"),
        max: policy.maxSummerInternships,
        remaining: Math.max(0, policy.maxSummerInternships - countFor("SUMMER_INTERNSHIP")),
      },
      {
        cycle: "SIX_MONTH_INTERNSHIP",
        label: CYCLE_LABEL.SIX_MONTH_INTERNSHIP,
        used: countFor("SIX_MONTH_INTERNSHIP"),
        max: policy.maxSixMonthInternships,
        remaining: Math.max(
          0,
          policy.maxSixMonthInternships - countFor("SIX_MONTH_INTERNSHIP"),
        ),
      },
      {
        cycle: "FULL_TIME",
        label: CYCLE_LABEL.FULL_TIME,
        used: fullTime.length,
        max: policy.maxFullTimeTotal,
        remaining: Math.max(0, policy.maxFullTimeTotal - fullTime.length),
        perTier: batch.tierConfigs.map((tier) => ({
          tierKey: tier.key,
          label: tier.label,
          used: fullTime.filter((offer) => offer.tierKey === tier.key).length,
          max: policy.maxFullTimePerTier,
        })),
      },
    ],
  };
}

type TierRow = { key: string; label: string; rank: number; minCtcLpa: unknown };

/**
 * The highest-ranked tier among the offers a student holds, across every
 * cycle: a six-month internship whose package lands in Tier 1 closes the tiers
 * below it exactly as a Tier 1 full-time offer does. Rank 1 is the top.
 */
function bestTierHeld(
  offers: Array<{ tierKey: string | null }>,
  tiers: TierRow[],
): TierRow | null {
  let best: TierRow | null = null;
  for (const offer of offers) {
    const tier = tiers.find((candidate) => candidate.key === offer.tierKey);
    if (tier && (best === null || tier.rank < best.rank)) best = tier;
  }
  return best;
}

/**
 * The authoritative check. Called inside the submission action, after the tier
 * has been resolved from the package — a student cannot claim a tier, it is
 * derived from what they entered.
 */
export async function checkQuota(
  studentId: string,
  batchId: string,
  cycle: OfferCycle,
  tierKey: string | null,
): Promise<QuotaVerdict> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { submissionRule: true, tierConfigs: true },
  });
  if (!batch?.submissionRule) {
    return { allowed: false, reason: "This batch has no submission policy configured." };
  }

  const policy = batch.submissionRule;
  const existing = await prisma.offer.findMany({
    where: { studentId, batchId, deletedAt: null },
    select: { cycle: true, tierKey: true },
  });

  const sameCycle = existing.filter((offer) => offer.cycle === cycle);

  const totalLimit =
    cycle === "SUMMER_INTERNSHIP"
      ? policy.maxSummerInternships
      : cycle === "SIX_MONTH_INTERNSHIP"
        ? policy.maxSixMonthInternships
        : policy.maxFullTimeTotal;

  if (sameCycle.length >= totalLimit) {
    return {
      allowed: false,
      reason:
        totalLimit === 1
          ? `You have already recorded your ${CYCLE_LABEL[cycle].toLowerCase()} for this batch. Edit that one instead.`
          : `You have recorded ${sameCycle.length} of ${totalLimit} ${CYCLE_LABEL[cycle].toLowerCase()}s allowed for this batch.`,
    };
  }

  if (cycle === "FULL_TIME" && tierKey) {
    const inTier = sameCycle.filter((offer) => offer.tierKey === tierKey).length;
    if (inTier >= policy.maxFullTimePerTier) {
      const label = batch.tierConfigs.find((tier) => tier.key === tierKey)?.label ?? tierKey;
      return {
        allowed: false,
        reason: `You have already recorded a full-time offer in ${label}. The policy allows ${policy.maxFullTimePerTier} per tier.`,
      };
    }
  }

  // A higher offer closes the tiers below it. The caps above are per cycle and
  // per tier, so without this a student could record a Tier 1 offer and then a
  // Tier 3 one, which the placement rules do not allow. Only an offer whose
  // package resolves to a tier can be judged; one with no package has no tier
  // and passes, because there is nothing to compare.
  if (policy.closeLowerTiers && tierKey) {
    const incoming = batch.tierConfigs.find((tier) => tier.key === tierKey);
    const held = bestTierHeld(existing, batch.tierConfigs);
    if (incoming && held && incoming.rank > held.rank) {
      return {
        allowed: false,
        reason:
          `You already hold a ${held.label} offer, and the policy closes the tiers below it. ` +
          `This package lands in ${incoming.label}, so it cannot be recorded.`,
      };
    }
  }

  return { allowed: true };
}
