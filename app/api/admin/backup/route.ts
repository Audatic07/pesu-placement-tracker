import { requireRole } from "@/lib/auth/rbac";
import { createLogicalBackup } from "@/lib/admin/backup";

export const maxDuration = 60;

export async function GET() {
  const owner = await requireRole("SUPER_ADMIN");
  const backup = await createLogicalBackup(owner.id);
  return new Response(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="placement-private-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
