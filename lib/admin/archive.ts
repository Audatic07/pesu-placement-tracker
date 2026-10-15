import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { ensureBatch } from "@/lib/policy/batch";
import { reconcileStandIns } from "@/lib/offers/standins";
import { AdminError, assertAdmin, snapshot } from "./access";
import { resolveAdminCompany } from "./offers";
import {
  PlacementArchive,
  archiveSummary,
  type PlacementArchiveData,
} from "./archive-schema";

export async function loadPlacementArchive(
  actorId: string,
  raw: PlacementArchiveData,
  reviewedDigest: string,
) {
  const archive = PlacementArchive.parse(raw);
  const summary = archiveSummary(archive);
  if (summary.digest !== reviewedDigest)
    throw new AdminError("The archive changed after review. Review it again.");
  return prisma.$transaction(
    async (tx) => {
      // Coordinate with the ordinary admin editor and CSV imports.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(18472011)`;
      await assertAdmin(tx, actorId, "SUPER_ADMIN");
      const previous = await tx.auditLog.findFirst({
        where: {
          entityType: "PlacementArchive",
          entityId: summary.digest,
          action: "IMPORT",
        },
      });
      if (previous) return { ...summary, alreadyImported: true, yielded: 0 };

      const backup = await tx.auditLog.findFirst({
        where: {
          actorId,
          entityType: "DatabaseBackup",
          action: "EXPORT",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (!backup)
        throw new AdminError(
          "Download a private database backup from Operations before importing the archive.",
        );

      const years = Object.keys(summary.batches).map(Number);
      const ids = archive.entries.map((value) => value.id);
      const collision = await tx.offer.findFirst({
        where: {
          OR: [
            { id: { in: ids } },
            {
              source: "OFFICIAL_IMPORT",
              studentId: null,
              batch: { year: { in: years } },
            },
          ],
        },
        select: { id: true },
      });
      if (collision)
        throw new AdminError(
          "Historical outcomes already exist for an archive batch. Compare the existing records first; this import never replaces them.",
        );

      const batches = new Map<number, string>();
      for (const year of years) {
        const batch = await ensureBatch(year, tx);
        batches.set(year, batch.id);
        const tiers = await tx.tierConfig.findMany({
          where: { batchId: batch.id },
          select: { key: true },
        });
        const keys = new Set(tiers.map((tier) => tier.key));
        if (
          archive.entries.some(
            (value) =>
              value.batchYear === year &&
              value.tierKey !== null &&
              !keys.has(value.tierKey),
          )
        )
          throw new AdminError(
            `Batch ${year} is missing a recorded archive tier. Review its settings first.`,
          );
      }
      const companies = new Map<string, string>();
      for (const name of new Set(
        archive.entries.map((value) => value.companyName),
      ))
        companies.set(name, await resolveAdminCompany(tx, name));

      // Bounded statements remain below PostgreSQL's parameter limit. All chunks
      // share one transaction; any failure rolls back the complete archive.
      for (let offset = 0; offset < archive.entries.length; offset += 500) {
        const entries = archive.entries.slice(offset, offset + 500);
        await tx.compensationPackage.createMany({
          data: entries.map(({ compensation }) => {
            const { components: _components, ...data } = compensation;
            return data;
          }),
        });
        await tx.offer.createMany({
          data: entries.map((value): Prisma.OfferCreateManyInput => {
            const {
              companyName,
              batchYear,
              compensation,
              rounds: _rounds,
              ...data
            } = value;
            return {
              ...data,
              companyId: companies.get(companyName)!,
              batchId: batches.get(batchYear)!,
              compensationId: compensation.id,
            };
          }),
        });
        const components = entries.flatMap((value) =>
          value.compensation.components.map((item, index) => ({
            ...item,
            id: `${value.compensation.id}-component-${index + 1}`,
            packageId: value.compensation.id,
          })),
        );
        if (components.length)
          await tx.compensationComponent.createMany({ data: components });
        const rounds = entries.flatMap((value) =>
          value.rounds.map((item) => ({
            ...item,
            offerId: value.id,
            heldOn: item.heldOn ? new Date(item.heldOn) : null,
            heldUntil: item.heldUntil ? new Date(item.heldUntil) : null,
          })),
        );
        if (rounds.length) await tx.interviewRound.createMany({ data: rounds });
      }
      let yielded = 0;
      for (const batchId of batches.values())
        yielded += await reconcileStandIns(tx, batchId);
      const written = await tx.offer.groupBy({
        by: ["batchId"],
        where: { id: { in: ids } },
        _count: true,
      });
      for (const [year, batchId] of batches)
        if (
          written.find((row) => row.batchId === batchId)?._count !==
          summary.batches[year]
        )
          throw new AdminError(
            "Archive count verification failed. Nothing was imported.",
          );
      await tx.auditLog.create({
        data: {
          actorId,
          action: "IMPORT",
          entityType: "PlacementArchive",
          entityId: summary.digest,
          after: snapshot({ ...summary, yielded, backupAuditId: backup.id }),
          summary: `Imported ${summary.outcomes} prepared anonymous outcomes with ${summary.components} components and ${summary.rounds} recruiting rounds.`,
        },
      });
      return { ...summary, alreadyImported: false, yielded };
    },
    { timeout: 240_000, maxWait: 15_000 },
  );
}
