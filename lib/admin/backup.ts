import "server-only";
import { prisma } from "@/lib/db";
import { assertAdmin } from "./access";

// Dependency order for restoring into an empty, migrated database. Fixed table
// names are never accepted from a request or interpolated from uploaded data.
export const BACKUP_TABLES = [
  "Campus",
  "Branch",
  "Program",
  "Batch",
  "TierConfig",
  "BatchBranchStrength",
  "SubmissionPolicy",
  "TaxRegimeConfig",
  "CpiIndex",
  "Student",
  "Company",
  "CompanyAlias",
  "CompanyWatch",
  "Drive",
  "CompensationPackage",
  "CompensationComponent",
  "DriveRole",
  "DriveFunnel",
  "Offer",
  "OfferRevision",
  "InterviewRound",
  "Report",
  "AuditLog",
  "Notification",
] as const;

export async function createLogicalBackup(actorId: string) {
  return prisma.$transaction(
    async (tx) => {
      await assertAdmin(tx, actorId, "SUPER_ADMIN");
      await tx.auditLog.create({
        data: {
          actorId,
          action: "EXPORT",
          entityType: "DatabaseBackup",
          summary:
            "Owner downloaded a complete logical backup, including private student records.",
        },
      });
      const tables: Record<string, unknown[]> = {};
      for (const table of BACKUP_TABLES) {
        // PostgreSQL serializes dates and decimals without lossy JS conversion.
        const result = await tx.$queryRawUnsafe<Array<{ rows: unknown[] }>>(
          `SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM "${table}" t`,
        );
        tables[table] = result[0]!.rows;
      }
      return {
        format: "pesu-placement-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        migrations: await tx.$queryRaw<
          Array<{ migration_name: string }>
        >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
        tables,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 55_000 },
  );
}
