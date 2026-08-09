import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getCompanyTrend } from "@/lib/analytics/queries";
import { canShowName } from "@/lib/privacy/gate";
import {
  EmptyState,
  PageHeader,
  Panel,
  Stat,
  StatGrid,
  StatusBadge,
  Tag,
  formatCompactInr,
  formatCount,
  formatDate,
  formatLpa,
  type Tone,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await prisma.company.findUnique({ where: { slug }, select: { name: true } });
  return { title: `${company?.name ?? "Company"} · PESU Placement Tracker` };
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  COMPLETED: { label: "Hired", tone: "good" },
  ANNOUNCED: { label: "No result recorded", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "accent" },
  NO_HIRES: { label: "Interviewed, hired nobody", tone: "critical" },
  DITCHED: { label: "Never ran the process", tone: "warning" },
};

const CYCLE: Record<string, string> = {
  SUMMER_INTERNSHIP: "Summer internship",
  SIX_MONTH_INTERNSHIP: "Internship",
  FULL_TIME: "Full time",
};

const ROUND: Record<string, string> = {
  PRE_PLACEMENT_TALK: "Pre-placement talk",
  RESUME_SHORTLIST: "Resume shortlist",
  ONLINE_ASSESSMENT: "Online assessment",
  GROUP_DISCUSSION: "Group discussion",
  TAKE_HOME_ASSIGNMENT: "Take-home",
  HACKATHON: "Hackathon",
  TECHNICAL_INTERVIEW: "Technical interview",
  SYSTEM_DESIGN: "System design",
  MANAGERIAL: "Managerial",
  HIRING_MANAGER: "Hiring manager",
  HR: "HR",
  OTHER: "Other",
};

const VERIFICATION: Record<string, { label: string; tone: Tone }> = {
  UNVERIFIED: { label: "Not corroborated", tone: "neutral" },
  CORROBORATED: { label: "Corroborated", tone: "good" },
  ADMIN_VERIFIED: { label: "Verified", tone: "good" },
  DISPUTED: { label: "Disputed", tone: "critical" },
};

const MODE: Record<string, string> = {
  ONLINE: "Online",
  IN_PERSON: "In person",
  HYBRID: "Hybrid",
  UNKNOWN: "Not recorded",
};

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireStudent();
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const company = await prisma.company.findUnique({
    where: { slug },
    include: {
      parent: { select: { name: true, slug: true } },
      children: { select: { name: true, slug: true } },
      aliases: { select: { alias: true } },
      // Student submissions, which carry the process notes and the per-person
      // detail the imported drive rows never had. Removed and soft-deleted
      // records are excluded here rather than filtered in the view.
      offers: {
        where: { deletedAt: null, verification: { not: "REMOVED" } },
        select: {
          id: true,
          roleTitle: true,
          cycle: true,
          nameVisibility: true,
          verification: true,
          deletedAt: true,
          cgpaBand: true,
          createdAt: true,
          student: { select: { name: true } },
          batch: { select: { year: true } },
          branch: { select: { code: true } },
          compensation: { select: { ctcLpa: true } },
        },
        orderBy: [{ batch: { year: "desc" } }, { createdAt: "desc" }],
      },
      drives: {
        include: {
          batch: { select: { year: true } },
          roles: {
            include: {
              compensation: { include: { components: true } },
              rounds: { orderBy: { sequence: "asc" } },
            },
          },
        },
        orderBy: [{ batch: { year: "desc" } }, { visitNumber: "asc" }],
      },
    },
  });

  if (!company) notFound();

  const trend = await getCompanyTrend(company.id);
  const years = [...new Set(trend.map((point) => point.batchYear))];
  const allCtc = trend.map((point) => point.highestCtc).filter((v): v is number => v !== null);

  // Never summed together: a 2026 offer can appear both as part of an imported
  // headcount and as a student's own submission, and adding the two would count
  // that person twice.
  const importedPlaced = trend
    .filter((point) => point.source === "imported")
    .reduce((sum, point) => sum + point.studentsPlaced, 0);
  const latest = trend[trend.length - 1];

  const otherNames = company.aliases
    .map((alias) => alias.alias)
    .filter((alias) => alias.toLowerCase() !== company.name.toLowerCase());

  const backHref = query["batch"] ? `/companies?batch=${query["batch"]}` : "/companies";

  return (
    <>
      <PageHeader
        title={company.name}
        description={
          <>
            {company.parent ? (
              <>
                Part of{" "}
                <Link href={`/companies/${company.parent.slug}`} className="underline underline-offset-2">
                  {company.parent.name}
                </Link>
                .{" "}
              </>
            ) : null}
            {otherNames.length > 0 ? <>Also recorded as {otherNames.join(", ")}. </> : null}
            {company.children.length > 0 ? (
              <>
                Arms tracked separately:{" "}
                {company.children.map((child, index) => (
                  <span key={child.slug}>
                    {index > 0 ? ", " : ""}
                    <Link href={`/companies/${child.slug}`} className="underline underline-offset-2">
                      {child.name}
                    </Link>
                  </span>
                ))}
                .
              </>
            ) : null}
          </>
        }
        actions={
          <Link
            href={backHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px]"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft size={14} />
            All companies
          </Link>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        <StatGrid>
          <Stat label="Seasons on record" value={formatCount(years.length)} hint={years.join(", ")} />
          <Stat
            label="Reported here"
            value={formatCount(company.offers.length)}
            hint={
              importedPlaced > 0
                ? `${formatCount(importedPlaced)} more in imported history`
                : "Student submissions"
            }
          />
          <Stat
            label="Highest CTC"
            value={allCtc.length ? formatLpa(Math.max(...allCtc)) : "—"}
          />
          <Stat
            label="Most recent"
            value={formatLpa(latest?.highestCtc)}
            hint={latest ? `Batch of ${latest.batchYear}` : undefined}
          />
          <Stat
            label="Imported visits"
            value={formatCount(company.drives.length)}
            hint={company.drives.length > 0 ? "From the 2026 sheets" : "None"}
          />
        </StatGrid>

        {trend.length > 1 ? (
          <Panel
            title="Year on year"
            description="Nominal figures. Rows are never summed across the two sources: an imported row is a headcount the old spreadsheet published, a reported row is people who filed here."
            padded={false}
          >
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Batch", "Cycle", "Source", "Offers", "Highest CTC", "CGPA bar"].map(
                    (heading, index) => (
                      <th
                        key={heading}
                        className={`h-8 px-4 text-[11px] font-medium uppercase tracking-[0.05em] ${
                          index >= 3 ? "text-right" : "text-left"
                        }`}
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {[...trend].reverse().map((point, index) => (
                  <tr
                    key={`${point.batchYear}-${point.source}-${index}`}
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    <td className="tnum h-[38px] px-4 font-medium">{point.batchYear}</td>
                    <td className="px-4" style={{ color: "var(--text-secondary)" }}>
                      {CYCLE[point.cycle] ?? point.cycle}
                    </td>
                    <td className="px-4">
                      {point.source === "students" ? (
                        <StatusBadge tone="accent">Students</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">
                          {STATUS[point.status]?.label ?? "Imported"}
                        </StatusBadge>
                      )}
                    </td>
                    <td className="tnum px-4 text-right">{formatCount(point.studentsPlaced)}</td>
                    <td className="tnum px-4 text-right">{formatLpa(point.highestCtc)}</td>
                    <td className="tnum px-4 text-right">{point.gpaCutoff ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ) : null}

        {company.offers.length > 0 ? (
          <Panel
            title="Reported by students"
            description="Each one opens the full offer — the package broken down, the rounds, and the notes on the process."
            padded={false}
          >
            <ul>
              {company.offers.map((offer) => {
                const verification = VERIFICATION[offer.verification] ?? {
                  label: offer.verification,
                  tone: "neutral" as Tone,
                };
                return (
                  <li key={offer.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <Link
                      href={`/offers/${offer.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--panel-hover)]"
                    >
                      <span className="tnum w-10 shrink-0 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        {offer.batch.year}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{offer.roleTitle}</span>
                        <span className="block truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                          {canShowName(offer) && offer.student
                            ? offer.student.name
                            : "Reported anonymously"}
                          {offer.branch ? ` · ${offer.branch.code}` : ""}
                          {offer.cgpaBand ? ` · CGPA ${offer.cgpaBand}` : ""}
                          {` · ${CYCLE[offer.cycle] ?? offer.cycle}`}
                        </span>
                      </span>
                      <span className="hidden shrink-0 sm:block">
                        <StatusBadge tone={verification.tone}>{verification.label}</StatusBadge>
                      </span>
                      <span className="tnum w-16 shrink-0 text-right text-[13px]">
                        {formatLpa(offer.compensation?.ctcLpa ? Number(offer.compensation.ctcLpa) : null, false)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {company.offers.length === 0 && company.drives.length === 0 ? (
          <Panel>
            <EmptyState
              title="Nothing recorded for this company yet"
              description="It is in the list because a name matched, but no student has filed an offer here and no imported season covers it."
            />
          </Panel>
        ) : null}

        {company.drives.length > 0 ? (
          <div
            className="flex items-baseline gap-2 pt-1 text-[11px] font-medium uppercase tracking-[0.06em]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Imported history
            <span className="text-[12px] font-normal normal-case tracking-normal">
              From the placement spreadsheets, kept as context. Company-level: a headcount, not
              people. None of it feeds the batch statistics.
            </span>
          </div>
        ) : null}

        {company.drives.map((drive) => {
          const status = STATUS[drive.status] ?? { label: drive.status, tone: "neutral" as Tone };
          const rounds = drive.roles
            .flatMap((role) => role.rounds)
            .sort((a, b) => a.sequence - b.sequence);

          return (
            <Panel
              key={drive.id}
              title={`Batch of ${drive.batch.year}${drive.visitNumber > 1 ? ` · visit ${drive.visitNumber}` : ""}`}
              description={CYCLE[drive.cycle] ?? drive.cycle}
              actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
              padded={false}
            >
              <div
                className="flex flex-wrap gap-x-8 gap-y-2 border-b px-4 py-3 text-[12px]"
                style={{ borderColor: "var(--line)" }}
              >
                <Fact label="Eligible branches">
                  {drive.eligibleBranches.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {drive.eligibleBranches.map((code) => (
                        <Tag key={code}>{code}</Tag>
                      ))}
                    </span>
                  ) : (
                    "Not recorded"
                  )}
                </Fact>
                <Fact label="CGPA requirement">{drive.gpaCutoffRaw ?? "Not recorded"}</Fact>
                <Fact label="Pre-placement talk">{formatDate(drive.pptDate)}</Fact>
              </div>

              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    {["Role", "Stipend", "Base", "CTC", "Cash yr 1", "Offers"].map((heading, index) => (
                      <th
                        key={heading}
                        className={`h-8 px-4 text-[11px] font-medium uppercase tracking-[0.05em] ${
                          index >= 1 ? "text-right" : "text-left"
                        }`}
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drive.roles.map((role) => {
                    const pkg = role.compensation;
                    const placed =
                      (role.placedInternship ?? 0) + (role.placedFte ?? 0) + (role.placedBoth ?? 0);
                    return (
                      <tr key={role.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td className="h-[38px] px-4">{role.title}</td>
                        <td className="tnum px-4 text-right">
                          {pkg?.stipendPerMonthInr
                            ? formatCompactInr(Number(pkg.stipendPerMonthInr))
                            : "—"}
                        </td>
                        <td className="tnum px-4 text-right">
                          {formatLpa(pkg?.baseLpa ? Number(pkg.baseLpa) : null, false)}
                        </td>
                        <td className="tnum px-4 text-right font-medium">
                          {formatLpa(pkg?.ctcLpa ? Number(pkg.ctcLpa) : null, false)}
                        </td>
                        <td className="tnum px-4 text-right">
                          {formatLpa(
                            pkg?.firstYearCashLpa ? Number(pkg.firstYearCashLpa) : null,
                            false,
                          )}
                        </td>
                        <td className="tnum px-4 text-right">{placed > 0 ? placed : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {rounds.length > 0 ? (
                <div className="border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
                  <div
                    className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Process
                  </div>
                  <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
                    {rounds.map((round, index) => (
                      <li key={round.id} className="flex items-center gap-2">
                        {index > 0 ? (
                          <span aria-hidden style={{ color: "var(--text-tertiary)" }}>
                            →
                          </span>
                        ) : null}
                        <span
                          className="inline-flex items-baseline gap-2 rounded-[var(--radius-control)] px-2 py-1 text-[12px]"
                          style={{ background: "var(--viz-track)" }}
                        >
                          <span>{ROUND[round.kind] ?? round.kind}</span>
                          <span className="tnum" style={{ color: "var(--text-tertiary)" }}>
                            {round.rawSchedule ?? formatDate(round.heldOn)}
                          </span>
                          {round.mode !== "UNKNOWN" ? (
                            <span style={{ color: "var(--text-tertiary)" }}>
                              {MODE[round.mode]}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "var(--text-tertiary)" }}>{label}</div>
      <div className="mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </div>
  );
}
