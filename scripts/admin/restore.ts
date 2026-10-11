import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "../../lib/db";
import { BACKUP_TABLES } from "../../lib/admin/backup";

async function main() {
  const path = process.argv[2];
  if (!path || process.argv[3] !== "--empty-database")
    throw new Error(
      "Usage: npm run backup:restore -- /private/backup.json --empty-database",
    );
  const backup = JSON.parse(await readFile(path, "utf8"));
  if (
    backup.format !== "pesu-placement-backup" ||
    backup.version !== 1 ||
    !backup.tables ||
    !Array.isArray(backup.migrations)
  )
    throw new Error("Unsupported backup format.");
  await prisma.$transaction(
    async (tx) => {
      const migrations = await tx.$queryRaw<
        Array<{ migration_name: string }>
      >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
      if (JSON.stringify(migrations) !== JSON.stringify(backup.migrations))
        throw new Error(
          "Restore into a database with exactly the backup's migrations applied.",
        );
      for (const table of BACKUP_TABLES) {
        const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) FROM "${table}"`,
        );
        if (rows[0]!.count !== 0n)
          throw new Error(
            "The target database is not empty. Restore only into a fresh migrated database; existing data is never replaced.",
          );
        if (!Array.isArray(backup.tables[table]))
          throw new Error(`Missing backup table: ${table}.`);
      }
      for (const table of BACKUP_TABLES) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
          JSON.stringify(backup.tables[table]),
        );
      }
      await tx.auditLog.create({
        data: {
          action: "IMPORT",
          entityType: "DatabaseRestore",
          summary:
            "Restored a complete logical backup into an empty migrated database.",
        },
      });
    },
    { timeout: 120_000 },
  );
  console.log(
    "Backup restored atomically. Verify health, owner login and batch totals before routing traffic.",
  );
}
main()
  .catch(() => {
    console.error(
      "Restore failed. Check that the backup is valid and the migrated target is empty. No partial restore was committed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
