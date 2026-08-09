import "server-only";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recomputeCorroboration } from "@/lib/offers/submit";
import type { ReportReason } from "@/generated/prisma/enums";
import type { StudentModel } from "@/generated/prisma/models";

/**
 * Reporting and moderation.
 *
 * Two asymmetries are deliberate:
 *
 *   The reporter is never shown to the person they reported. Students sit in
 *   the same classrooms; a visible reporter turns a data-quality tool into a
 *   social one, and nobody would use it.
 *
 *   An upheld report does not delete anything. Offers are soft-deleted with a
 *   reason and a full before/after snapshot, because a moderation decision that
 *   cannot be reviewed later is indistinguishable from censorship, and this
 *   system is meant to be handed to a stranger in ten years.
 */

export type FileReportResult = { ok: true } | { ok: false; error: string };

export async function fileReport(
  reporter: StudentModel,
  offerId: string,
  reason: ReportReason,
  details: string | null,
): Promise<FileReportResult> {
  const limit = await consumeRateLimit(`report:${reporter.id}`, 8, 24 * 60 * 60);
  if (!limit.allowed) {
    return {
      ok: false,
      error: "You have filed a lot of reports today. Try again tomorrow, or message an admin.",
    };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { id: true, studentId: true, deletedAt: true },
  });
  if (!offer || offer.deletedAt) return { ok: false, error: "That offer no longer exists." };

  if (offer.studentId === reporter.id) {
    return { ok: false, error: "You cannot report your own entry. Edit or remove it instead." };
  }

  const existing = await prisma.report.findFirst({
    where: { offerId, reporterId: reporter.id, reason },
  });
  if (existing) {
    return { ok: false, error: "You have already reported this entry for that reason." };
  }

  await prisma.report.create({
    data: { offerId, reporterId: reporter.id, reason, details: details?.trim() || null },
  });

  // Two independent reports is enough to stop showing the figure as settled
  // while a human looks at it. It does not hide the entry.
  const openCount = await prisma.report.count({
    where: { offerId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  if (openCount >= 2) {
    await prisma.offer.update({
      where: { id: offerId },
      data: { verification: "DISPUTED" },
    });
  }

  await recordAudit({
    actorId: reporter.id,
    action: "CREATE",
    entityType: "Report",
    entityId: offerId,
    summary: `Report filed against offer ${offerId} (${reason}).`,
  });

  return { ok: true };
}

export type ResolveAction = "KEEP" | "REMOVE" | "VERIFY";

export async function resolveReports(
  admin: StudentModel,
  offerId: string,
  action: ResolveAction,
  note: string | null,
): Promise<FileReportResult> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { compensation: true },
  });
  if (!offer) return { ok: false, error: "That offer no longer exists." };

  const before = {
    verification: offer.verification,
    deletedAt: offer.deletedAt,
    deletedReason: offer.deletedReason,
  };

  const data =
    action === "REMOVE"
      ? {
          verification: "REMOVED" as const,
          deletedAt: new Date(),
          deletedReason: note?.trim() || "Removed after review.",
        }
      : action === "VERIFY"
        ? { verification: "ADMIN_VERIFIED" as const, deletedAt: null, deletedReason: null }
        : { verification: "UNVERIFIED" as const, deletedAt: null, deletedReason: null };

  const updated = await prisma.offer.update({ where: { id: offerId }, data });

  await prisma.report.updateMany({
    where: { offerId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    data: {
      status: action === "REMOVE" ? "UPHELD" : "REJECTED",
      resolvedById: admin.id,
      resolutionNote: note?.trim() || null,
      resolvedAt: new Date(),
    },
  });

  // Keeping an entry re-runs corroboration so it can settle back to whatever
  // the other reports support, rather than staying frozen at "disputed".
  if (action !== "REMOVE") {
    await recomputeCorroboration(offer.companyId, offer.batchId, offer.cycle);
  }

  await recordAudit({
    actorId: admin.id,
    action: action === "REMOVE" ? "SOFT_DELETE" : "REPORT_RESOLVE",
    entityType: "Offer",
    entityId: offerId,
    before,
    after: {
      verification: updated.verification,
      deletedAt: updated.deletedAt,
      deletedReason: updated.deletedReason,
    },
    summary: `${admin.srn} resolved reports on offer ${offerId} as ${action}.`,
  });

  return { ok: true };
}

/** Restores a soft-deleted offer. Nothing in this system is ever unrecoverable. */
export async function restoreOffer(
  admin: StudentModel,
  offerId: string,
): Promise<FileReportResult> {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) return { ok: false, error: "That offer no longer exists." };

  await prisma.offer.update({
    where: { id: offerId },
    data: { deletedAt: null, deletedReason: null, verification: "UNVERIFIED" },
  });

  await recordAudit({
    actorId: admin.id,
    action: "RESTORE",
    entityType: "Offer",
    entityId: offerId,
    before: { deletedAt: offer.deletedAt, deletedReason: offer.deletedReason },
    after: { deletedAt: null },
    summary: `${admin.srn} restored offer ${offerId}.`,
  });

  return { ok: true };
}
