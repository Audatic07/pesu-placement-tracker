import type { PrismaClient } from "@/generated/prisma/client";
import type { OfferCycle, OfferNature } from "@/generated/prisma/enums";

/**
 * Stand-ins.
 *
 * A row the import expands from a sheet's headcount stands for a student who
 * has not filed. "IBM placed 88" is eighty-eight stand-ins, each the same
 * shape as a submission, so an archived season reads through the same code as
 * a live one. That shape has one obligation the sheet cannot meet on its own:
 * a person must be counted once.
 *
 * When a student files their own offer for a company, batch and cycle the
 * sheet already counted, one stand-in yields to it — soft-deleted, marked with
 * the offer it yielded to. The count stays what the sheet said; the anonymous
 * row is replaced by the person it stood for, with the CGPA, rounds and notes
 * only they could give. If that offer is later removed, the stand-in returns:
 * the sheet's count was right all along and the person was not.
 *
 * Matching is by company, batch and cycle, preferring the same nature. A
 * student the sheet did not count — a company it never listed — displaces
 * nothing, and the count rises by one, which is the sheet being corrected. A
 * stand-in never yields to another stand-in.
 *
 * No `server-only` here: the import script runs this after every expansion,
 * and it has no request context. Callers pass the client in.
 */

export const STAND_IN_YIELDED = "Yielded to a student's own submission for the same placement.";

type Client = Pick<PrismaClient, "offer">;

export type Person = {
  id: string;
  companyId: string;
  batchId: string;
  cycle: OfferCycle;
  nature: OfferNature;
};

/**
 * One stand-in yields to this person's offer. Returns the stand-in's id, or
 * null when nothing stood for them. Idempotent: an offer that has already
 * displaced a stand-in displaces no second one.
 */
export async function yieldStandIn(prisma: Client, person: Person): Promise<string | null> {
  const already = await prisma.offer.findFirst({
    where: { yieldedToId: person.id },
    select: { id: true },
  });
  if (already) return already.id;

  const standing = {
    companyId: person.companyId,
    batchId: person.batchId,
    cycle: person.cycle,
    source: "OFFICIAL_IMPORT" as const,
    studentId: null,
    deletedAt: null,
  };

  // Same nature first — an internship-only stand-in should not yield to a
  // full-time offer while a full-time one is standing — then any. Two people
  // filing at once can pick the same candidate, so the write is conditional
  // on it still standing, and a lost race moves on to the next one.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate =
      (await prisma.offer.findFirst({
        where: { ...standing, nature: person.nature },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })) ??
      (await prisma.offer.findFirst({
        where: standing,
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }));
    if (!candidate) return null;

    const claimed = await prisma.offer.updateMany({
      where: { id: candidate.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: STAND_IN_YIELDED, yieldedToId: person.id },
    });
    if (claimed.count === 1) return candidate.id;
  }

  return null;
}

/**
 * Brings back whatever stood aside for this offer. Called when the offer is
 * removed: the person is no longer on record, so the sheet's count is once
 * again the only word on that placement.
 */
export async function restoreStandInsOf(prisma: Client, offerId: string): Promise<number> {
  const result = await prisma.offer.updateMany({
    where: { yieldedToId: offerId, source: "OFFICIAL_IMPORT" },
    data: { deletedAt: null, deletedReason: null, yieldedToId: null },
  });
  return result.count;
}

/**
 * After an import has expanded a batch afresh, every person already on record
 * displaces a stand-in again. Returns how many yielded.
 */
export async function reconcileStandIns(prisma: Client, batchId: string): Promise<number> {
  const people = await prisma.offer.findMany({
    where: { batchId, source: { not: "OFFICIAL_IMPORT" }, deletedAt: null },
    select: { id: true, companyId: true, batchId: true, cycle: true, nature: true },
    orderBy: { createdAt: "asc" },
  });

  let yielded = 0;
  for (const person of people) {
    if (await yieldStandIn(prisma, person)) yielded += 1;
  }
  return yielded;
}
