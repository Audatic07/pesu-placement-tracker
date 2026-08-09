import Link from "next/link";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  getBatchOverview,
  getBranchBreakdown,
  getCgpaVersusPackage,
  getCtcInflationLeaders,
  getTierBreakdown,
} from "@/lib/analytics/queries";
import { Histogram } from "@/components/data/charts";
import {
  EmptyState,
  PageHeader,
  Panel,
  SourceNote,
  Withheld,
  formatCompactInr,
  formatCount,
  formatLpa,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analysis · PESU Placement Tracker" };

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const student = await requireStudent("/analysis");
  const params = await searchParams;

  const batches = await prisma.batch.findMany({ orderBy: { year: "desc" }, select: { year: true } });
  const requested = Number.parseInt(params["batch"] ?? "", 10);
  const batchYear =
    batches.find((batch) => batch.year === requested)?.year ??
    student.graduationYear ??
    batches[0]?.year ??
    new Date().getFullYear();

  const q = `?batch=${batchYear}`;

  const [overview, tiers, branches, inflation, cgpa] = await Promise.all([
    getBatchOverview({ batchYear }),
    getTierBreakdown(batchYear),
    getBranchBreakdown(batchYear),
    getCtcInflationLeaders(batchYear, 25),
    getCgpaVersusPackage(batchYear),
  ]);

  if (!overview || overview.reportCount === 0) {
    return (
      <>
        <PageHeader title="Analysis" />
        <EmptyState
          title="Nothing recorded for this batch yet"
          description="These cuts are computed from student submissions. There are none for this batch."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analysis"
        description={`The deeper cuts for the batch of ${batchYear}, from ${formatCount(
          overview.reportCount,
        )} student submissions. Figures are withheld until the group is large enough that no individual can be identified.`}
      />

      <div className="flex flex-col gap-5 p-6">
        <Panel
          title="Package distribution"
          description="One entry per reported offer — a real package a real person was given."
        >
          <Histogram buckets={overview.ctcHistogram} unit=" LPA" />
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["Highest", formatLpa(overview.ctc.highest)],
                ["90th pct", formatLpa(overview.ctc.p90)],
                ["75th pct", formatLpa(overview.ctc.p75)],
                ["Median", formatLpa(overview.ctc.median)],
                ["25th pct", formatLpa(overview.ctc.p25)],
                ["Mean", formatLpa(overview.ctc.average)],
                ["Std dev", formatLpa(overview.ctc.standardDeviation, false)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div
                  className="text-[11px] uppercase tracking-[0.05em]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {label}
                </div>
                <div className="tnum mt-0.5 text-[15px] font-medium">{value}</div>
              </div>
            ))}
          </div>
          <SourceNote>
            Every offer counts once, whoever reported it. {formatCount(overview.ctc.count)} of{" "}
            {formatCount(overview.reportCount)} submissions stated a CTC; the rest are internships
            and offers whose package was never disclosed.
          </SourceNote>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="By tier" padded={false}>
            <Table
              head={["Tier", "Companies", "Offers", "Median", "Highest"]}
              rows={tiers.map((tier) => ({
                key: tier.tierKey,
                cells: [
                  tier.label,
                  formatCount(tier.companies),
                  formatCount(tier.reports),
                  formatLpa(tier.ctc.median, false),
                  formatLpa(tier.ctc.highest, false),
                ],
              }))}
            />
          </Panel>

          <Panel
            title="By branch"
            description="Two different questions: how many companies called for a branch, and how many offers students of that branch actually got. Both come from submissions."
            padded={false}
          >
            <Table
              head={["Branch", "Called for", "Offers", "Median", "Highest"]}
              rows={branches.map((branch) => ({
                key: branch.branchCode,
                cells: [
                  branch.branchCode,
                  formatCount(branch.companiesOpenTo),
                  formatCount(branch.offersReported),
                  formatLpa(branch.ctc.median, false),
                  formatLpa(branch.ctc.highest, false),
                ],
              }))}
            />
          </Panel>
        </div>

        <Panel
          title="Headline versus cash"
          description="A quoted CTC can include equity that has not vested, money paid once, and the value of subsidised meals. This is the multiple between the headline and the cash reaching a student in year one."
          padded={false}
        >
          {inflation.length === 0 ? (
            <EmptyState title="Nobody has broken a package down far enough to compare yet." />
          ) : (
            <Table
              head={["Company", "Headline", "Cash yr 1", "Multiple", "Non-cash"]}
              rows={inflation.map((row) => ({
                key: row.key,
                href: `/companies/${row.companySlug}${q}`,
                cells: [
                  row.companyName,
                  formatLpa(row.ctcLpa, false),
                  formatLpa(row.firstYearCashLpa, false),
                  row.ratio === null ? "—" : `${row.ratio.toFixed(2)}×`,
                  row.nonCashLpa > 0 ? formatLpa(row.nonCashLpa, false) : "—",
                ],
              }))}
            />
          )}
          <div className="px-4 pb-4">
            <SourceNote>
              Where a submission gave no component breakdown, first-year cash falls back to the
              stated base pay, so the multiple is a floor rather than an exact figure.
            </SourceNote>
          </div>
        </Panel>

        <Panel
          title="Does CGPA decide who gets an offer?"
          description="Each point is one student who reported both their CGPA and their package."
        >
          {cgpa.suppressed ? (
            <Withheld
              reason={
                "This is built from students reporting their own CGPA beside their own package, and " +
                "fills in as more people submit — " +
                cgpa.reason.toLowerCase()
              }
            />
          ) : (
            <Table
              head={["CGPA band", "Median CTC", "Offers"]}
              rows={bandRows(cgpa.value)}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

function bandRows(points: Array<{ cgpa: number; ctcLpa: number }>) {
  const buckets = new Map<string, number[]>();
  for (const point of points) {
    const lower = Math.floor(point.cgpa * 2) / 2;
    const label = `${lower.toFixed(1)} – ${(lower + 0.5).toFixed(1)}`;
    const bucket = buckets.get(label);
    if (bucket) bucket.push(point.ctcLpa);
    else buckets.set(label, [point.ctcLpa]);
  }

  return [...buckets.entries()]
    // Bands holding fewer than three offers are dropped: at that size the band
    // is a person, not a statistic.
    .filter(([, values]) => values.length >= 3)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([band, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
          : (sorted[mid] ?? 0);
      return {
        key: band,
        cells: [band, formatLpa(median, false), formatCount(values.length)],
      };
    });
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: Array<{ key: string; href?: string; cells: React.ReactNode[] }>;
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing to show yet." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {head.map((heading, index) => (
              <th
                key={heading}
                className={`h-8 whitespace-nowrap px-4 text-[11px] font-medium uppercase tracking-[0.05em] ${
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
                  className={`h-[34px] whitespace-nowrap px-4 ${
                    index === 0 ? "text-left font-medium" : "tnum text-right"
                  }`}
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
    </div>
  );
}
