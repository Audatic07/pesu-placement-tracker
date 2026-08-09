import Link from "next/link";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { logout } from "@/app/(auth)/login/actions";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  Stat,
  StatGrid,
  formatCount,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "My offers · PESU Placement Tracker" };

export default async function MePage() {
  const student = await requireStudent("/me");

  const [branch, program, campus, batch, offers] = await Promise.all([
    student.branchId ? prisma.branch.findUnique({ where: { id: student.branchId } }) : null,
    student.programId ? prisma.program.findUnique({ where: { id: student.programId } }) : null,
    student.campusId ? prisma.campus.findUnique({ where: { id: student.campusId } }) : null,
    student.graduationYear
      ? prisma.batch.findUnique({
          where: { year: student.graduationYear },
          include: { submissionRule: true, tierConfigs: { orderBy: { rank: "asc" } } },
        })
      : null,
    prisma.offer.findMany({
      where: { studentId: student.id, deletedAt: null },
      include: { company: { select: { name: true, slug: true } }, compensation: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const policy = batch?.submissionRule;
  const used = {
    summer: offers.filter((offer) => offer.cycle === "SUMMER_INTERNSHIP").length,
    internship: offers.filter((offer) => offer.cycle === "SIX_MONTH_INTERNSHIP").length,
    fullTime: offers.filter((offer) => offer.cycle === "FULL_TIME").length,
  };

  return (
    <>
      <PageHeader
        title="My offers"
        description="Only you and the admins can see this page. What appears publicly is controlled per offer, and is anonymous unless you say otherwise."
        actions={
          <>
            <Button href="/submit" variant="primary">
              Add an offer
            </Button>
            <form action={logout}>
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        <StatGrid>
          <Stat label="SRN" value={student.srn} />
          <Stat label="Branch" value={branch?.code ?? "—"} hint={branch?.name} />
          <Stat label="Programme" value={program?.code ?? "—"} />
          <Stat label="Campus" value={campus?.name ?? "—"} hint={student.section ? `Section ${student.section}` : undefined} />
          <Stat
            label="Graduating"
            value={student.graduationYear ? String(student.graduationYear) : "—"}
            hint={student.currentSemester ? `Semester ${student.currentSemester}` : undefined}
          />
        </StatGrid>

        {policy ? (
          <Panel title="What you can record" description={policy.description ?? undefined}>
            <ul className="flex flex-col gap-2 text-[13px]">
              <Quota label="Summer internship" used={used.summer} max={policy.maxSummerInternships} />
              <Quota label="Internships" used={used.internship} max={policy.maxSixMonthInternships} />
              <Quota label="Full-time offers" used={used.fullTime} max={policy.maxFullTimeTotal} />
            </ul>
          </Panel>
        ) : null}

        <Panel title="Your submissions" padded={false}>
          {offers.length === 0 ? (
            <EmptyState
              title="You have not recorded an offer yet"
              description="Adding yours is what makes the per-student figures — CGPA against package, how many rounds companies actually run — possible for everyone."
              action={
                <Button href="/submit" variant="primary">
                  Add an offer
                </Button>
              }
            />
          ) : (
            <ul>
              {offers.map((offer) => (
                <li key={offer.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <Link
                    href={`/offers/${offer.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--panel-hover)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {offer.company.name}
                      </span>
                      <span
                        className="block truncate text-[12px]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {offer.roleTitle}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[13px]">
                      {offer.compensation?.ctcLpa ? `${Number(offer.compensation.ctcLpa)} LPA` : "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Quota({ label, used, max }: { label: string; used: number; max: number }) {
  const full = used >= max;
  return (
    <li className="flex items-center gap-3">
      <span className="w-40 shrink-0">{label}</span>
      <span className="flex flex-1 gap-1">
        {Array.from({ length: max }, (_unused, index) => (
          <span
            key={index}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: index < used ? "var(--accent)" : "var(--viz-track)" }}
          />
        ))}
      </span>
      <span className="tnum w-12 shrink-0 text-right" style={{ color: full ? "var(--text)" : "var(--text-tertiary)" }}>
        {used} / {max}
      </span>
    </li>
  );
}
