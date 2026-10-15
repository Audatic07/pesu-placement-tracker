import { requireRole } from "@/lib/auth/rbac";
import { importTemplate } from "@/lib/admin/csv";

export async function GET() {
  await requireRole("ADMIN");
  return new Response(importTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="placement-import-template.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
