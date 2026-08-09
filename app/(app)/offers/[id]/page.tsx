import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Flag, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireStudent, roleAtLeast } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { canShowName } from "@/lib/privacy/gate";
import {
  PageHeader,
  Panel,
  Stat,
  StatGrid,
  StatusBadge,
  Tag,
  formatCompactInr,
  formatDate,
  formatLpa,
  type Tone,
} from "@/components/ui/primitives";
import { ReportButton } from "./report-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offer · PESU Placement Tracker" };

const ROUND: Record<string, string> = {
  PRE_PLACEMENT_TALK: "Pre-placement talk",
  RESUME_SHORTLIST: "Resume shortlist",
  ONLINE_ASSESSMENT: "Online assessment",
  GROUP_DISCUSSION: "Group discussion",
  TAKE_HOME_ASSIGNMENT: "Take-home assignment",
  HACKATHON: "Hackathon",
  TECHNICAL_INTERVIEW: "Technical interview",
  SYSTEM_DESIGN: "System design",
  MANAGERIAL: "Managerial",
  HIRING_MANAGER: "Hiring manager",
  HR: "HR",
  OTHER: "Other",
};

const COMPONENT: Record<string, string> = {
  FIXED_BASE: "Fixed base",
  VARIABLE_PAY: "Variable pay",
  JOINING_BONUS: "Joining bonus",
  RETENTION_BONUS: "Retention bonus",
  RELOCATION: "Relocation",
  ESOP: "ESOPs",
  RSU: "RSUs",
  GRATUITY: "Gratuity",
  PROVIDENT_FUND: "Provident fund",
  INSURANCE: "Insurance",
  PERKS: "Perks",
  OTHER: "Other",
};

const WORK_MODE: Record<string, string> = {
  ONSITE: "In office",
  HYBRID: "Hybrid",
  REMOTE: "Fully remote",
};

const VERIFICATION: Record<string, { label: string; tone: Tone; icon: typeof ShieldCheck }> = {
  UNVERIFIED: { label: "Not yet corroborated", tone: "neutral", icon: Flag },
  CORROBORATED: { label: "Matches other reports", tone: "good", icon: CheckCircle2 },
  ADMIN_VERIFIED: { label: "Verified by an admin", tone: "good", icon: ShieldCheck },
  DISPUTED: { label: "Disputed — under review", tone: "critical", icon: TriangleAlert },
  REMOVED: { label: "Removed", tone: "critical", icon: TriangleAlert },
};

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requireStudent();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const offer = await prisma.offer.findUnique({
    where: { id },
    include: {
      company: { select: { name: true, slug: true } },
      batch: { select: { year: true } },
      branch: { select: { code: true, name: true } },
      student: { select: { id: true, name: true } },
      compensation: { include: { components: true } },
      rounds: { orderBy: { sequence: "asc" } },
      reports: { select: { id: true, status: true } },
    },
  });

  if (!offer || (offer.deletedAt !== null && !roleAtLeast(viewer.role, "ADMIN"))) notFound();

  const isOwner = offer.studentId === viewer.id;
  const isAdmin = roleAtLeast(viewer.role, "ADMIN");
  const showName = canShowName(offer);

  const verification = VERIFICATION[offer.verification] ?? VERIFICATION["UNVERIFIED"]!;
  const pkg = offer.compensation;

  // Exact CGPA is the owner's and the admins' to see; everyone else gets a band.
  const cgpaDisplay =
    isOwner || isAdmin
      ? offer.cgpa
        ? Number(offer.cgpa).toFixed(2)
        : "—"
      : (offer.cgpaBand ?? "—");

  const cashComponents = pkg?.components.filter((component) => component.isCash) ?? [];
  const nonCashComponents = pkg?.components.filter((component) => !component.isCash) ?? [];

  return (
    <>
      <PageHeader
        title={`${offer.company.name} — ${offer.roleTitle}`}
        description={
          <>
            {showName && offer.student ? offer.student.name : "Reported anonymously"}
            {offer.branch ? ` · ${offer.branch.code}` : ""} · Batch of {offer.batch.year}
            {isOwner ? " · This is yours" : ""}
          </>
        }
        actions={
          <>
            <Link
              href={`/companies/${offer.company.slug}?batch=${offer.batch.year}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              <ArrowLeft size={14} />
              {offer.company.name}
            </Link>
            {!isOwner ? <ReportButton offerId={offer.id} /> : null}
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge tone={verification.tone}>{verification.label}</StatusBadge>
            {offer.isOutlierFlagged ? (
              <StatusBadge tone="warning">Flagged as an outlier</StatusBadge>
            ) : null}
            {query["new"] === "1" ? (
              <StatusBadge tone="good">Recorded — thank you</StatusBadge>
            ) : null}
          </div>
        }
      />

      <div className="flex max-w-4xl flex-col gap-5 p-6">
        {offer.isOutlierFlagged && offer.outlierNote ? (
          <p
            className="rounded-[var(--radius-control)] px-3 py-2.5 text-[13px] leading-relaxed"
            style={{
              background: "color-mix(in srgb, var(--warning) 12%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <strong style={{ color: "var(--text)" }}>Flagged for review.</strong>{" "}
            {offer.outlierNote} It is shown as reported — a genuine outlier is exactly the kind of
            offer worth seeing — but it carries this note until someone confirms it.
          </p>
        ) : null}

        <StatGrid>
          <Stat label="CTC" value={formatLpa(pkg?.ctcLpa ? Number(pkg.ctcLpa) : null)} />
          <Stat
            label="Cash, year 1"
            value={formatLpa(pkg?.firstYearCashLpa ? Number(pkg.firstYearCashLpa) : null)}
            hint="Excludes unvested equity and perks"
          />
          <Stat
            label="Take-home"
            value={
              pkg?.estimatedInHandMonthlyInr
                ? `${formatCompactInr(Number(pkg.estimatedInHandMonthlyInr))}/mo`
                : "—"
            }
            hint={pkg?.computedForFinancialYear ? `${pkg.computedForFinancialYear} slabs` : undefined}
          />
          <Stat
            label="Stipend"
            value={
              pkg?.stipendPerMonthInr ? `${formatCompactInr(Number(pkg.stipendPerMonthInr))}/mo` : "—"
            }
          />
          <Stat label="CGPA" value={cgpaDisplay} hint={isOwner || isAdmin ? "Only you and admins see the exact figure" : "Banded"} />
        </StatGrid>

        {pkg && (cashComponents.length > 0 || nonCashComponents.length > 0) ? (
          <Panel
            title="What the package is made of"
            description="The gap between the headline and the cash is the whole reason this is recorded component by component."
            padded={false}
          >
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {[...cashComponents, ...nonCashComponents].map((component) => (
                  <tr key={component.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="h-[34px] px-4">
                      {COMPONENT[component.kind] ?? component.kind}
                      {component.isOneTime ? (
                        <span className="ml-2">
                          <Tag>one-time</Tag>
                        </span>
                      ) : null}
                      {!component.isCash ? (
                        <span className="ml-2">
                          <Tag>not cash</Tag>
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum px-4 text-right">
                      {component.currency === "USD"
                        ? `$${Number(component.amount).toLocaleString("en-IN")}`
                        : formatLpa(Number(component.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ) : null}

        <Panel
          title="The terms"
          description="What the offer binds you to, and the bar the company announced to get it."
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
            <Term label="Work mode">{WORK_MODE[offer.workMode] ?? "Not reported"}</Term>
            <Term label="Location">
              {offer.locations.length > 0 ? offer.locations.join(", ") : "Not reported"}
            </Term>
            <Term label="Bond">
              {offer.bondMonths === null
                ? "Not reported"
                : offer.bondMonths === 0
                  ? "None"
                  : `${offer.bondMonths} months`}
            </Term>
            <Term label="Internship length">
              {offer.internshipDurationMonths === null
                ? "Not reported"
                : `${offer.internshipDurationMonths} months`}
            </Term>
            <Term label="CGPA cutoff announced">
              {offer.announcedCgpaCutoff === null
                ? "Not reported"
                : Number(offer.announcedCgpaCutoff).toFixed(2)}
            </Term>
            <Term label="Branches called">
              {offer.eligibleBranches.length > 0 ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {offer.eligibleBranches.map((code) => (
                    <Tag key={code}>{code}</Tag>
                  ))}
                </span>
              ) : (
                "Not reported"
              )}
            </Term>
          </dl>
        </Panel>

        {offer.rounds.length > 0 ? (
          <Panel title="The process" padded={false}>
            <ol>
              {offer.rounds.map((round) => (
                <li
                  key={round.id}
                  className="px-4 py-3"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tnum text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                      {round.sequence}
                    </span>
                    <span className="text-[13px] font-medium">
                      {ROUND[round.kind] ?? round.kind}
                    </span>
                    {round.heldOn ? (
                      <span className="tnum text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        {formatDate(round.heldOn)}
                      </span>
                    ) : null}
                    {round.mode !== "UNKNOWN" ? (
                      <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        {round.mode === "IN_PERSON" ? "in person" : round.mode.toLowerCase()}
                      </span>
                    ) : null}
                    {round.difficulty ? (
                      <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                        difficulty {round.difficulty}/5
                      </span>
                    ) : null}
                    {round.topics.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {round.topics.map((topic) => (
                          <Tag key={topic}>{topic}</Tag>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  {round.questionsAsked ? (
                    <p
                      className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {round.questionsAsked}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}

        {offer.processNotes ? (
          <Panel title="Notes on the process">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{offer.processNotes}</p>
          </Panel>
        ) : null}

        {offer.preparationResources ? (
          <Panel title="What they prepared with">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
              {offer.preparationResources}
            </p>
          </Panel>
        ) : null}

        {pkg?.estimatedInHandMonthlyInr ? (
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            The take-home figure is an estimate, not a quote: income tax under the{" "}
            {pkg.computedForFinancialYear} slabs, employee provident fund at the configured rate with
            basic assumed to be 40% of gross, and professional tax. One-time joining money is
            excluded, because it arrives once rather than every month.
          </p>
        ) : null}
      </div>
    </>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--text-tertiary)" }}>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
