import "dotenv/config";
import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "../../lib/db";
import { createLogicalBackup } from "../../lib/admin/backup";

async function main() {
  const destination = process.argv[2];
  if (!destination)
    throw new Error("Usage: npm run backup:create -- /private/backup.json");
  const owner = await prisma.student.findFirst({
    where: { role: "SUPER_ADMIN", isSuspended: false },
    orderBy: { createdAt: "asc" },
  });
  if (!owner)
    throw new Error(
      "A verified owner account must exist before creating an app backup. Use pg_dump for operator recovery before first login.",
    );
  const backup = await createLogicalBackup(owner.id);
  const path = resolve(destination);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(backup));
  } finally {
    await file.close();
  }
  console.log("Private logical backup saved. Never commit it to Git.");
}
main()
  .catch(() => {
    console.error(
      "Backup failed. Check database access and choose a new private output path.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
