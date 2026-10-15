import { getBatchYears, getAnalyticsVersion } from "@/lib/analytics/batches";
import { prisma } from "@/lib/db";
import { getCurrentStudent, roleAtLeast } from "@/lib/auth/rbac";
import { LiveRefresh } from "@/components/data/live-refresh";
import { Sidebar } from "@/components/shell/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const student = await getCurrentStudent();

  const [years, branch, pendingReports, version] = await Promise.all([
    getBatchYears(),
    student?.branchId
      ? prisma.branch.findUnique({ where: { id: student.branchId }, select: { code: true } })
      : null,
    student && roleAtLeast(student.role, "ADMIN")
      ? prisma.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } })
      : 0,
    getAnalyticsVersion(),
  ]);

  return (
    <div className="min-h-dvh">
      <LiveRefresh initialVersion={version} />
      <Sidebar
        batches={years}
        activeBatch={student?.graduationYear ?? years[0] ?? new Date().getFullYear()}
        student={student ? {
          name: student.name,
          srn: student.srn,
          role: student.role,
          branch: branch?.code ?? null,
        } : null}
        pendingReportCount={pendingReports}
      />
      <div className="lg:pl-[236px]">{children}</div>
    </div>
  );
}
