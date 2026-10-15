import Link from "next/link";
import { parseCgpaParam, WITHIN_REACH, type CgpaOutlook } from "@/lib/analytics/outlook";
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
  getCgpaOutlook,
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

  const chosenCgpa = parseCgpaParam(params["cgpa"]);
  const [overview, tiers, branches, inflation, cgpa, outlook] = await Promise.all([
    getBatchOverview({ batchYear }),
    getTierBreakdown(batchYear),
    getBranchBreakdown(batchYear),
    getCtcInflationLeaders(batchYear, 25),
    getCgpaVersusPackage(batchYear),
    chosenCgpa === null ? null : getCgpaOutlook(batchYear, chosenCgpa),
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
          description="Median package by CGPA band, including bands with a single student report. Historical records have no individual CGPA. Recipient names stay hidden."
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

        <Panel
          title="Where a CGPA stands"
          description="Pick a CGPA — yours, or the one you are aiming for — and read what this batch's records say about it: which announced bars it clears, and what people at that CGPA reported getting."
        >
          <form method="get" action="/analysis" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="batch" value={batchYear} />
            <label className="flex flex-col gap-1 text-[12px] font-medium">
              CGPA
              <input
                name="cgpa"
                type="number"
                inputMode="decimal"
                min="0"
                max="10"
                step="0.01"
                required
                defaultValue={chosenCgpa ?? ""}
                placeholder="e.g. 8.2"
                className="tnum h-[30px] w-32 rounded-[var(--radius-control)] px-2 text-[13px] outline-none"
                style={{
                  background: "var(--panel)",
                  color: "var(--text)",
                  boxShadow: "inset 0 0 0 1px var(--line-strong)",
                }}
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-[30px] items-center rounded-[var(--radius-control)] px-3 text-[13px] font-medium"
              style={{ background: "var(--accent-solid)", color: "var(--accent-fg)" }}
            >
              Show
            </button>
            {outlook ? (
              <Link href={`/analysis${q}`} className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                Clear
              </Link>
            ) : null}
          </form>

          {outlook ? <Outlook outlook={outlook} q={q} /> : null}

          <SourceNote>
            Past seasons, self-reported. A bar is what a company announced, as students heard it —
            not who it hired. Nothing typed here is stored; it only shapes this view, and the
            address bar carries it if you want to send it to someone.
          </SourceNote>
        </Panel>
      </div>
    </>
  );
}

function Outlook({ outlook, q }: { outlook: CgpaOutlook; q: string }) {
  const { eligibility, peers, peerRange } = outlook;
  const cgpaLabel = outlook.cgpa.toFixed(2);

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div>
        <h3 className="text-[13px] font-medium">Announced bars at {cgpaLabel}</h3>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {eligibility.withKnownBar === 0
            ? "No company's announced cutoff has been reported for this batch yet."
            : `Clears the bar at ${formatCount(eligibility.cleared)} of ${formatCount(
                eligibility.withKnownBar,
              )} companies whose cutoff someone reported.`}
        </p>

        <BarList
          title={`Within ${WITHIN_REACH.toFixed(1)} of it`}
          note="A little more and these open up."
          bars={eligibility.withinReach}
          total={eligibility.withinReachTotal}
          q={q}
        />
        <BarList
          title="Further than that"
          note="Nearest bar first, not biggest package first."
          bars={eligibility.outOfReach}
          total={eligibility.outOfReachTotal}
          q={q}
        />
      </div>

      <div>
        <h3 className="text-[13px] font-medium">
          People between {peerRange.from.toFixed(2)} and {peerRange.to.toFixed(2)}
        </h3>
        {peers.suppressed ? (
          <div className="mt-2">
            <Withheld
              reason={
                "Built from students who reported their own CGPA beside their own package. " +
                peers.reason
              }
            />
          </div>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-3 gap-4">
              {[
                ["Offers", formatCount(peers.value.offers)],
                ["Median CTC", formatLpa(peers.value.medianCtc)],
                [
                  "Middle half",
                  peers.value.p25Ctc === null || peers.value.p75Ctc === null
                    ? "—"
                    : `${formatLpa(peers.value.p25Ctc, false)} – ${formatLpa(peers.value.p75Ctc)}`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <div
                    className="text-[11px] uppercase tracking-[0.05em]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {label}
                  </div>
                  <div className="tnum mt-1 text-[17px] font-medium">{value}</div>
                </div>
              ))}
            </div>
            <SummaryTable
              head={["Tier", "Offers"]}
              rows={[
                ...peers.value.byTier.map((tier) => ({
                  key: tier.tierKey,
                  cells: [tier.label, formatCount(tier.offers)],
                })),
                ...(peers.value.untiered > 0
                  ? [{ key: "none", cells: ["No CTC given", formatCount(peers.value.untiered)] }]
                  : []),
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}

function BarList({
  title,
  note,
  bars,
  total,
  q,
}: {
  title: string;
  note: string;
  bars: CgpaOutlook["eligibility"]["withinReach"];
  total: number;
  q: string;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[12px] font-medium">{title}</h4>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {note}
        </span>
      </div>
      <ul className="mt-1.5 flex flex-col">
        {bars.map((bar) => (
          <li
            key={bar.companySlug}
            className="flex h-7 items-center justify-between gap-3 border-b text-[13px]"
            style={{ borderColor: "var(--line)" }}
          >
            <Link href={`/companies/${bar.companySlug}${q}`} className="truncate">
              {bar.companyName}
            </Link>
            <span className="tnum" style={{ color: "var(--text-secondary)" }}>
              {bar.announcedCgpaCutoff.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
      {total > bars.length ? (
        <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          and {formatCount(total - bars.length)} more.
        </p>
      ) : null}
    </div>
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
