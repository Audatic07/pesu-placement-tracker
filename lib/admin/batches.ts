import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ensureBatch } from "@/lib/policy/batch";
import { AdminError, assertAdmin, snapshot } from "./access";

const cap = z.coerce.number().int().min(0).max(20);
export const BatchSettings = z
  .object({
    year: z.coerce.number().int().min(2000).max(9999),
    updatedAt: z.iso.datetime(),
    archived: z.boolean(),
    seasonStartsAt: z.iso.date().optional(),
    seasonEndsAt: z.iso.date().optional(),
    maxSummerInternships: cap,
    maxSixMonthInternships: cap,
    maxFullTimePerTier: cap,
    maxFullTimeTotal: cap,
    closeLowerTiers: z.boolean(),
    description: z.string().max(2000),
    reason: z.string().trim().min(5).max(500),
    tiers: z
      .array(
        z.object({
          key: z.string().regex(/^[A-Z][A-Z0-9_]{0,29}$/),
          label: z.string().trim().min(1).max(60),
          rank: z.number().int().min(1).max(20),
          minCtcLpa: z.number().finite().min(0).max(1000),
          maxCtcLpa: z.number().finite().min(0).max(1000).nullable(),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((value, context) => {
    if (
      value.seasonStartsAt &&
      value.seasonEndsAt &&
      value.seasonEndsAt < value.seasonStartsAt
    )
      context.addIssue({
        code: "custom",
        message: "The season end must follow its start.",
      });
    if (
      new Set(value.tiers.map((tier) => tier.key)).size !==
        value.tiers.length ||
      new Set(value.tiers.map((tier) => tier.rank)).size !== value.tiers.length
    )
      context.addIssue({
        code: "custom",
        message: "Tier keys and ranks must be unique.",
      });
    const sorted = [...value.tiers].sort((a, b) => a.minCtcLpa - b.minCtcLpa);
    if (sorted[0]?.minCtcLpa !== 0 || sorted.at(-1)?.maxCtcLpa !== null)
      context.addIssue({
        code: "custom",
        message: "Tiers must cover CTC from zero to an unbounded top tier.",
      });
    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i]!;
      if (
        (tier.maxCtcLpa !== null && tier.maxCtcLpa <= tier.minCtcLpa) ||
        (i < sorted.length - 1 && tier.maxCtcLpa !== sorted[i + 1]!.minCtcLpa)
      )
        context.addIssue({
          code: "custom",
          message: "Tier ranges must meet without gaps or overlaps.",
        });
      if (i < sorted.length - 1 && tier.rank <= sorted[i + 1]!.rank)
        context.addIssue({
          code: "custom",
          message: "Higher CTC tiers must have lower ranks.",
        });
    }
  });

export async function createAdminBatch(actorId: string, year: number) {
  const parsedYear = z.number().int().min(2000).max(9999).parse(year);
  // ensureBatch inherits the latest configured policy. Never run the seed over
  // an existing deployment: it overwrites administrative settings.
  await prisma.$transaction(async (tx) => {
    await assertAdmin(tx, actorId);
    const batch = await ensureBatch(parsedYear, tx);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "CONFIG_CHANGE",
        entityType: "Batch",
        entityId: batch.id,
        summary: `Ensured batch ${parsedYear} with inherited policy.`,
      },
    });
  });
}

export async function saveBatchSettings(
  actorId: string,
  input: z.infer<typeof BatchSettings>,
) {
  const values = BatchSettings.parse(input);
  return prisma.$transaction(async (tx) => {
    await assertAdmin(tx, actorId);
    await tx.$queryRaw`SELECT id FROM "Batch" WHERE year = ${values.year} FOR UPDATE`;
    const before = await tx.batch.findUnique({
      where: { year: values.year },
      include: { tierConfigs: true, submissionRule: true },
    });
    if (!before || before.updatedAt.toISOString() !== values.updatedAt)
      throw new AdminError("Batch settings changed. Reload before saving.");
    const policy = {
      maxSummerInternships: values.maxSummerInternships,
      maxSixMonthInternships: values.maxSixMonthInternships,
      maxFullTimeTotal: values.maxFullTimeTotal,
      maxFullTimePerTier: values.maxFullTimePerTier,
      closeLowerTiers: values.closeLowerTiers,
      description: values.description || null,
    };
    const previousKeys = new Set(before.tierConfigs.map((tier) => tier.key));
    if (values.tiers.some((tier) => !previousKeys.has(tier.key)))
      throw new AdminError(
        "Keep the existing tier keys so historical outcomes retain their meaning. Labels and thresholds can change.",
      );
    if (values.tiers.length !== before.tierConfigs.length)
      throw new AdminError(
        "Keep all existing tiers so historical outcomes retain their meaning.",
      );
    for (const tier of values.tiers)
      await tx.tierConfig.update({
        where: { batchId_key: { batchId: before.id, key: tier.key } },
        data: tier,
      });
    const after = await tx.batch.update({
      where: { id: before.id },
      data: {
        isArchived: values.archived,
        seasonStartsAt: values.seasonStartsAt
          ? new Date(values.seasonStartsAt)
          : null,
        seasonEndsAt: values.seasonEndsAt
          ? new Date(values.seasonEndsAt)
          : null,
        dataVersion: { increment: 1 },
        submissionRule: { upsert: { create: policy, update: policy } },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "CONFIG_CHANGE",
        entityType: "Batch",
        entityId: before.id,
        before: snapshot(before),
        after: snapshot({ ...after, tiers: values.tiers, policy }),
        summary: values.reason,
      },
    });
  });
}
