import { prisma } from "@/lib/db";
import { requireStudent } from "@/lib/auth/rbac";
import { roleAtLeast } from "@/lib/auth/rbac";
import { Sidebar } from "@/components/shell/sidebar";

export const dynamic = "force-dynamic";

/**
 * The application shell.
 *
 * Every authenticated screen renders inside this, so navigation is persistent
 * and a page change never costs the sidebar, the batch selection, or the
 * scroll position of the nav.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const student = await requireStudent();

  const [batches, branch, pendingReports] = await Promise.all([
    prisma.batch.findMany({ orderBy: { year: "desc" }, select: { year: true } }),
    student.branchId
      ? prisma.branch.findUnique({ where: { id: student.branchId }, select: { code: true } })
      : null,
    roleAtLeast(student.role, "ADMIN")
      ? prisma.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } })
      : 0,
  ]);

  const years = batches.map((batch) => batch.year);

  return (
    <div className="min-h-dvh">
      <Sidebar
        batches={years}
        activeBatch={student.graduationYear ?? years[0] ?? new Date().getFullYear()}
        student={{
          name: student.name,
          srn: student.srn,
          role: student.role,
          branch: branch?.code ?? null,
        }}
        pendingReportCount={pendingReports}
      />
      <div style={{ paddingLeft: "236px" }}>{children}</div>
    </div>
  );
}
