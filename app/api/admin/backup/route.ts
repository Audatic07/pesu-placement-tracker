import { requireRole } from "@/lib/auth/rbac";
import { createLogicalBackup } from "@/lib/admin/backup";
import { gzipSync } from "node:zlib";

export const maxDuration = 60;

export async function GET() {
  const owner = await requireRole("SUPER_ADMIN");
  const backup = await createLogicalBackup(owner.id);
  // Complete history exceeds function response limits as plain JSON.
  const compressed = new Uint8Array(gzipSync(JSON.stringify(backup)));
  return new Response(compressed, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="placement-private-backup-${new Date().toISOString().slice(0, 10)}.json.gz"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
