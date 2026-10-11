import { SummaryTable } from "@/components/data/summary-table";
import { median } from "@/lib/analytics/stats";
import { gate } from "@/lib/privacy/gate";
import { getBatchYears } from "@/lib/analytics/batches";
import { resolveBatchYear, singleParams, type SearchParams } from "@/lib/query-params";
import { formatLpa, formatCount } from "@/lib/format";
import { getCurrentStudent } from "@/lib/auth/rbac";
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
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analysis · PESU Placement Tracker" };

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const student = await getCurrentStudent();
  const params = singleParams(await searchParams);

  const years = await getBatchYears();
  const batchYear = resolveBatchYear(params["batch"], years, student?.graduationYear ?? null);

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
          description="No offer outcomes have been recorded for this batch."
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
        )} offer outcomes, including ${formatCount(overview.historicalCount)} historical records. Figures are withheld until the group is large enough that no individual can be identified.`}
      />

      <div className="flex flex-col gap-5 p-6">
        <Panel
          title="Package distribution"
          description="One entry per recorded offer. Prospective FTE packages for internship-only records are excluded."
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
            <SummaryTable
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
            <SummaryTable
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
          description="Company medians compare headline CTC with known first-year cash and annual non-cash components. Variable pay is a target, so actual payouts can differ."
          padded={false}
        >
          {inflation.length === 0 ? (
            <EmptyState title="Nobody has broken a package down far enough to compare yet." />
          ) : (
            <SummaryTable
              head={["Company", "Headline", "Known cash yr 1", "Multiple", "Known non-cash"]}
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
              Cash requires a stated base or itemised cash components. Missing amounts and
              bonuses with an unknown payment schedule stay unknown; headline CTC is never
              used as cash. Equity needs a known vesting term to be annualised.
            </SourceNote>
          </div>
        </Panel>

        <Panel
          title="Does CGPA decide who gets an offer?"
          description="Median package by CGPA band, shown only for bands with at least five student reports. Historical records have no individual CGPA."
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
            <SummaryTable
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
    .filter(([, values]) => !gate(values.length, () => null).suppressed)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([band, values]) => {
      return {
        key: band,
        cells: [band, formatLpa(median(values), false), formatCount(values.length)],
      };
    });
}
