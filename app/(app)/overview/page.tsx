import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  getBatchArchive,
  getBatchOverview,
  getCtcInflationLeaders,
  getAnnouncedCutoffs,
  getTierBreakdown,
  getTopRecruiters,
  type BatchArchive,
} from "@/lib/analytics/queries";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  SourceNote,
  Stat,
  StatGrid,
  StatusBadge,
  formatCompactInr,
  formatCount,
  formatLpa,
} from "@/components/ui/primitives";
import { TierBars } from "@/components/data/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · PESU Placement Tracker" };

const WORK_MODE: Record<string, string> = {
  ONSITE: "In office",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

const CYCLE_LABEL: Record<string, string> = {
  SUMMER_INTERNSHIP: "Summer internship",
  SIX_MONTH_INTERNSHIP: "Internship",
  FULL_TIME: "Full time",
};

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const student = await requireStudent("/overview");
  const params = await searchParams;

  const batches = await prisma.batch.findMany({ orderBy: { year: "desc" }, select: { year: true } });
  const requested = Number.parseInt(params["batch"] ?? "", 10);
  const batchYear =
    batches.find((batch) => batch.year === requested)?.year ??
    student.graduationYear ??
    batches[0]?.year ??
    new Date().getFullYear();

  const q = `?batch=${batchYear}`;

  const [overview, tiers, recruiters, cutoffs, inflation, archive] = await Promise.all([
    getBatchOverview({ batchYear }),
    getTierBreakdown(batchYear),
    getTopRecruiters(batchYear, 8),
    getAnnouncedCutoffs(batchYear),
    getCtcInflationLeaders(batchYear, 6),
    getBatchArchive(batchYear),
  ]);

  // Every live figure is built from submissions, so no submissions means no live
  // figures. A finished season is a different case: 2026 has an imported
  // spreadsheet behind it and nobody will ever file against it, so showing an
  // empty state there would hide the archive rather than be honest about it.
  if (!overview || overview.reportCount === 0) {
    return (
      <>
        <PageHeader
          title="Overview"
          description={
            archive
              ? `The batch of ${batchYear} as the placement spreadsheet recorded it. No student has filed here, and for a season this far past nobody will — everything below is imported history.`
              : `Batch of ${batchYear}`
          }
        />
        <div className="flex flex-col gap-5 p-6">
          {archive ? (
            <Archive archive={archive} q={q} standalone />
          ) : (
            <Panel>
              <EmptyState
                title="Nobody has recorded an offer for this batch yet"
                description="Every figure here is built from what students file themselves — packages, CGPA, rounds, cutoffs. The first submission starts it; until then there is nothing honest to show."
                action={
                  <Button href="/submit" variant="primary">
                    Add the first offer
                  </Button>
                }
              />
            </Panel>
          )}
        </div>
      </>
    );
  }

  const decided = overview.accepted + overview.declined;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`How the batch of ${batchYear} is doing, from ${formatCount(
          overview.reportCount,
        )} ${overview.reportCount === 1 ? "offer" : "offers"} students recorded themselves. Nothing here is drawn from the old placement sheets.`}
        actions={
          <Button href="/submit" variant="primary">
            Add yours
          </Button>
        }
      />

      <div className="flex flex-col gap-5 p-6">
        <StatGrid>
          <Stat
            label="Offers reported"
            value={formatCount(overview.reportCount)}
            hint={`${formatCount(overview.converted)} intern → full-time`}
          />
          <Stat
            label="Companies"
            value={formatCount(overview.companiesReported)}
            hint="At least one report each"
          />
          <Stat
            label="Median package"
            value={formatLpa(overview.ctc.median)}
            hint={`From ${formatCount(overview.ctc.count)} with a CTC`}
          />
          <Stat label="Highest" value={formatLpa(overview.ctc.highest)} />
          <Stat
            label="Accepted"
            value={formatCount(overview.accepted)}
            hint={
              decided > 0
                ? `${formatCount(overview.declined)} declined, ${formatCount(overview.undecided)} undecided`
                : "Nobody has said yet"
            }
          />
        </StatGrid>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Where offers landed"
            description="Tier boundaries are configured per batch, not fixed in the app."
          >
            <TierBars
              data={tiers.map((tier) => ({
                label: tier.label,
                value: tier.reports,
                detail: `${tier.companies} companies · median ${formatLpa(tier.ctc.median)}`,
              }))}
            />
            <SourceNote>
              Offers with no tier are ones where no CTC was reported, so there is nothing to place
              against a boundary. They are counted in the totals above.
            </SourceNote>
          </Panel>

          <Panel
            title="Most reported recruiters"
            description="How many people filed, not how many a company hired — those are different numbers and only the first one is knowable here."
            padded={false}
            actions={
              <Link
                href={`/companies${q}&sort=reports&dir=desc`}
                className="inline-flex items-center gap-1 text-[12px]"
                style={{ color: "var(--accent)" }}
              >
                All <ArrowRight size={12} />
              </Link>
            }
          >
            <MiniTable
              head={["Company", "Reports", "Median", "Highest"]}
              rows={recruiters.map((row) => ({
                key: row.companySlug,
                href: `/companies/${row.companySlug}${q}`,
                cells: [
                  row.companyName,
                  formatCount(row.reports),
                  formatLpa(row.medianCtc, false),
                  formatLpa(row.highestCtc, false),
                ],
              }))}
            />
          </Panel>

          <Panel
            title="What companies asked for"
            description="The CGPA bar each company announced, as students heard it."
            padded={false}
          >
            {cutoffs.length === 0 ? (
              <EmptyState
                title="No cutoffs reported yet"
                description="The submission form asks for the bar a company announced. It is the only place this can come from."
              />
            ) : (
              <MiniTable
                head={["Company", "Cutoff", "Lowest in", "Reports"]}
                rows={cutoffs.slice(0, 8).map((row) => ({
                  key: row.companySlug,
                  href: `/companies/${row.companySlug}${q}`,
                  cells: [
                    row.companyName,
                    row.announcedCgpaCutoff.toFixed(2),
                    row.lowestReportedCgpa === null ? "—" : row.lowestReportedCgpa.toFixed(2),
                    formatCount(row.reports),
                  ],
                }))}
              />
            )}
            <div className="px-4 pb-3">
              <SourceNote>
                &ldquo;Lowest in&rdquo; is the lowest CGPA that still got an offer, and appears only
                once at least three people have reported one — below that it is a person, not a
                pattern.
              </SourceNote>
            </div>
          </Panel>

          <Panel
            title="How much of a headline package is cash"
            description="Quoted CTC against the money actually reaching a student in year one."
            padded={false}
            actions={
              <Link
                href={`/analysis${q}`}
                className="inline-flex items-center gap-1 text-[12px]"
                style={{ color: "var(--accent)" }}
              >
                All <ArrowRight size={12} />
              </Link>
            }
          >
            {inflation.length === 0 ? (
              <EmptyState title="Nobody has broken a package down far enough to compare yet." />
            ) : (
              <MiniTable
                head={["Company", "CTC", "Cash yr 1", "×"]}
                rows={inflation.map((row) => ({
                  key: row.key,
                  href: `/companies/${row.companySlug}${q}`,
                  cells: [
                    row.companyName,
                    formatLpa(row.ctcLpa, false),
                    formatLpa(row.firstYearCashLpa, false),
                    row.ratio === null ? "—" : `${row.ratio.toFixed(2)}×`,
                  ],
                }))}
              />
            )}
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Internship stipends">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Highest", overview.stipend.highest],
                ["Upper quarter", overview.stipend.p75],
                ["Median", overview.stipend.median],
                ["Lower quarter", overview.stipend.p25],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <div
                    className="text-[11px] uppercase tracking-[0.05em]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {label}
                  </div>
                  <div className="tnum mt-1 text-[17px] font-medium">
                    {formatCompactInr(value as number | null)}
                  </div>
                </div>
              ))}
            </div>
            <SourceNote>
              Per month, from {formatCount(overview.stipend.count)} reported stipends.
            </SourceNote>
          </Panel>

          <Panel
            title="The terms attached"
            description="What an offer actually binds you to — the part a headline package never says."
          >
            {overview.terms.workMode.length === 0 &&
            overview.terms.withBond === 0 &&
            overview.terms.medianInternshipMonths === null ? (
              <EmptyState title="Nobody has reported work mode, bond or internship length yet." />
            ) : (
              <dl className="flex flex-col gap-3 text-[13px]">
                <Term label="Work mode">
                  {overview.terms.workMode.length === 0
                    ? "—"
                    : overview.terms.workMode
                        .map((mode) => `${WORK_MODE[mode.key] ?? mode.key} ${mode.count}`)
                        .join(" · ")}
                </Term>
                <Term label="Carry a bond">
                  {overview.terms.withBond === 0
                    ? "None reported"
                    : `${formatCount(overview.terms.withBond)} of ${formatCount(
                        overview.reportCount,
                      )}, median ${overview.terms.medianBondMonths} months`}
                </Term>
                <Term label="Internship length">
                  {overview.terms.medianInternshipMonths === null
                    ? "—"
                    : `${overview.terms.medianInternshipMonths} months, median`}
                </Term>
              </dl>
            )}
          </Panel>
        </div>

        {archive ? <Archive archive={archive} q={q} /> : null}
      </div>
    </>
  );
}

/**
 * The imported spreadsheet, shown as what it is.
 *
 * It sits below everything reported and never inside it. The figures are a
 * different kind of number — a headcount a company published, a package a
 * company advertised — and the moment they appear in the same table as a
 * student's own report, the page is answering "what did students get" with
 * "what did companies claim". Hence the separate panel, the badge, and the
 * refusal to put an imported row into any total above.
 */
function Archive({
  archive,
  q,
  standalone = false,
}: {
  archive: BatchArchive;
  q: string;
  standalone?: boolean;
}) {
  const placedLabel = archive.drivesWithoutHeadcount > 0 ? "at least" : "";

  return (
    <div className="flex flex-col gap-5">
      {!standalone ? (
        <div className="flex items-center gap-3 pt-2">
          <h2 className="text-[13px] font-medium">From the placement spreadsheet</h2>
          <StatusBadge tone="neutral">Imported</StatusBadge>
          <div className="h-px flex-1" style={{ background: "var(--line)" }} />
        </div>
      ) : null}

      <StatGrid>
        <Stat
          label="Companies on record"
          value={formatCount(archive.companies)}
          hint={`${formatCount(archive.drives)} visits`}
        />
        <Stat
          label="Students placed"
          value={`${placedLabel} ${formatCount(archive.studentsPlaced)}`.trim()}
          hint={
            archive.drivesWithoutHeadcount > 0
              ? `${formatCount(archive.drivesWithoutHeadcount)} visits recorded no headcount`
              : "As the sheet recorded it"
          }
        />
        <Stat
          label="Highest advertised"
          value={formatLpa(archive.ctc.highest)}
          hint={`From ${formatCount(archive.ctc.count)} packages`}
        />
        <Stat label="Median advertised" value={formatLpa(archive.ctc.median)} />
        <Stat
          label="Hired nobody"
          value={formatCount(archive.hiredNobody)}
          hint={`${formatCount(archive.ditched)} announced then ditched`}
        />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Where the advertised packages sat"
          description="Tier is derived from the package the company advertised, against this batch's boundaries."
          padded={false}
        >
          <MiniTable
            head={["Tier", "Visits", "Placed", "Median"]}
            rows={archive.byTier.map((tier) => ({
              key: tier.tierKey,
              cells: [
                tier.label,
                formatCount(tier.drives),
                formatCount(tier.studentsPlaced),
                formatLpa(tier.medianCtcLpa, false),
              ],
            }))}
          />
          <div className="px-4 pb-3 pt-3">
            <SourceNote>
              A visit with no advertised package sits in no tier, which is why the visit counts
              here can fall short of the {formatCount(archive.drives)} above.
            </SourceNote>
          </div>
        </Panel>

        <Panel
          title="Who hired the most"
          description="Headcounts the spreadsheet published — not people who filed here, and not comparable with the reported figures above."
          padded={false}
          actions={
            <Link
              href={`/companies${q}&source=imported`}
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: "var(--accent)" }}
            >
              All <ArrowRight size={12} />
            </Link>
          }
        >
          <MiniTable
            head={["Company", "Placed", "Highest", "Visits"]}
            rows={archive.topRecruiters.slice(0, 8).map((row) => ({
              key: row.companySlug,
              href: `/companies/${row.companySlug}${q}`,
              cells: [
                row.companyName,
                formatCount(row.studentsPlaced),
                formatLpa(row.highestCtcLpa, false),
                formatCount(row.visits),
              ],
            }))}
          />
        </Panel>

        <Panel title="By cycle" padded={false}>
          <MiniTable
            head={["Cycle", "Visits", "Placed"]}
            rows={archive.byCycle.map((row) => ({
              key: row.cycle,
              cells: [
                CYCLE_LABEL[row.cycle] ?? row.cycle,
                formatCount(row.drives),
                formatCount(row.studentsPlaced),
              ],
            }))}
          />
        </Panel>

        <Panel title="Advertised stipends">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Highest", archive.stipendPerMonthInr.highest],
              ["Upper quarter", archive.stipendPerMonthInr.p75],
              ["Median", archive.stipendPerMonthInr.median],
              ["Lower quarter", archive.stipendPerMonthInr.p25],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div
                  className="text-[11px] uppercase tracking-[0.05em]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {label}
                </div>
                <div className="tnum mt-1 text-[17px] font-medium">
                  {formatCompactInr(value as number | null)}
                </div>
              </div>
            ))}
          </div>
          <SourceNote>
            Per month, from {formatCount(archive.stipendPerMonthInr.count)} advertised packages.
          </SourceNote>
        </Panel>
      </div>

      <SourceNote>
        These rows come from the placement spreadsheet, not from students. They record what a
        company published — a headcount without names, at a package it advertised rather than one
        anyone confirmed receiving. They are never added to a reported figure, because the two
        answer different questions.
      </SourceNote>
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt style={{ color: "var(--text-tertiary)" }}>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function MiniTable({
  head,
  rows,
}: {
  head: string[];
  rows: Array<{ key: string; href?: string; cells: React.ReactNode[] }>;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--line)" }}>
          {head.map((heading, index) => (
            <th
              key={heading}
              className={`h-8 px-4 text-[11px] font-medium uppercase tracking-[0.05em] ${
                index === 0 ? "text-left" : "text-right"
              }`}
              style={{ color: "var(--text-tertiary)" }}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} style={{ borderBottom: "1px solid var(--line)" }}>
            {row.cells.map((cell, index) => (
              <td
                key={index}
                className={`h-[34px] px-4 ${index === 0 ? "text-left" : "tnum text-right"}`}
              >
                {index === 0 && row.href ? (
                  <Link href={row.href} className="hover:underline">
                    {cell}
                  </Link>
                ) : (
                  cell
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
