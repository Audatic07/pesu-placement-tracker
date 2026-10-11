import { OfferCycle } from "@/generated/prisma/enums";
import { getBatchYears } from "@/lib/analytics/batches";
import { choice, choiceList, list, positiveInteger, resolveBatchYear, singleParams, type SearchParams } from "@/lib/query-params";
import { formatLpa, formatCompactInr, formatCount, formatDate } from "@/lib/format";
import { CYCLE_LABELS } from "@/lib/offers/labels";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { queryDirectory, SORT_KEYS } from "@/lib/analytics/directory";
import { FilterBar } from "@/components/data/filter-bar";
import { DataTable, Pagination, type Column } from "@/components/data/table";
import type { DirectoryRow } from "@/lib/analytics/directory";
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  Tag,
  type Tone,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies · PESU Placement Tracker" };

const SOURCE: Record<string, { label: string; tone: Tone }> = {
  students: { label: "Reported", tone: "accent" },
  imported: { label: "Historical", tone: "neutral" },
};

const TIER_LABEL: Record<string, string> = {
  TIER_1: "T1",
  TIER_2: "T2",
  TIER_3: "T3",
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const student = await getCurrentStudent();
  const params = singleParams(await searchParams);

  const years = await getBatchYears();
  const batchYear = resolveBatchYear(params["batch"], years, student?.graduationYear ?? null);

  const sort = choice(params["sort"], SORT_KEYS) ?? "reports";

  const result = await queryDirectory({
    batchYear,
    search: params["q"],
    tierKeys: list(params["tier"]),
    branchCodes: list(params["branch"]),
    cycles: choiceList(params["cycle"], Object.values(OfferCycle)),
    sources: choiceList(params["source"], ["students", "imported"] as const),
    sort,
    direction: params["dir"] === "asc" ? "asc" : "desc",
    page: positiveInteger(params["page"]),
  });

  // Sorting and paging are links built from the current query, so every view
  // on this page is a URL someone can send.
  const tableQuery = { pathname: "/companies", params: { ...params, batch: String(batchYear) } };

  const columns: Array<Column<DirectoryRow>> = [
    {
      key: "company",
      header: "Company",
      sortKey: "name",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{row.companyName}</span>
          {row.tierKeys.map((tier) => (
            <Tag key={tier}>{TIER_LABEL[tier] ?? tier}</Tag>
          ))}
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      hideBelow: "lg",
      render: (row) => (
        <span className="block max-w-[26ch] truncate" style={{ color: "var(--text-secondary)" }}>
          {row.roleTitles.filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "cycle",
      header: "Cycle",
      hideBelow: "md",
      render: (row) => (
        <span style={{ color: "var(--text-secondary)" }}>{CYCLE_LABELS[row.cycle] ?? row.cycle}</span>
      ),
    },
    {
      key: "source",
      header: "Source",
      hideBelow: "sm",
      render: (row) => {
        const source = row.studentReports > 0 && row.historicalReports > 0
          ? { label: "Mixed", tone: "accent" as const }
          : SOURCE[row.studentReports > 0 ? "students" : "imported"]!;
        return <StatusBadge tone={source.tone}>{source.label}</StatusBadge>;
      },
    },
    {
      key: "reports",
      header: "Offers",
      sortKey: "reports",
      numeric: true,
      width: "88px",
      render: (row) => formatCount(row.reports),
    },
    {
      key: "stipend",
      header: "Stipend",
      sortKey: "stipend",
      numeric: true,
      width: "92px",
      hideBelow: "lg",
      render: (row) =>
        row.highestStipendInr !== null ? formatCompactInr(row.highestStipendInr) : <Muted>—</Muted>,
    },
    {
      key: "ctc",
      header: "CTC",
      sortKey: "ctc",
      numeric: true,
      width: "96px",
      render: (row) =>
        row.highestCtcLpa === null ? <Muted>—</Muted> : formatLpa(row.highestCtcLpa, false),
    },
    {
      key: "cash",
      header: "Known cash yr 1",
      numeric: true,
      width: "96px",
      hideBelow: "lg",
      render: (row) =>
        row.firstYearCashLpa === null ? (
          <Muted>—</Muted>
        ) : (
          <span
            title="Based on disclosed base and cash components; undisclosed allowances are not inferred"
            style={{
              color:
                row.highestCtcLpa && row.firstYearCashLpa / row.highestCtcLpa < 0.6
                  ? "var(--warning)"
                  : undefined,
            }}
          >
            {formatLpa(row.firstYearCashLpa, false)}
          </span>
        ),
    },
    {
      key: "cutoff",
      header: "CGPA",
      sortKey: "cutoff",
      numeric: true,
      width: "76px",
      hideBelow: "md",
      render: (row) =>
        row.cgpaCutoff === null ? (
          <Muted>—</Muted>
        ) : (
          <span title="Median announced eligibility cutoff across recorded submissions">
            {row.cgpaCutoff.toFixed(2)}
          </span>
        ),
    },
    {
      key: "date",
      header: "Started",
      sortKey: "date",
      numeric: true,
      width: "88px",
      hideBelow: "lg",
      render: (row) =>
        row.date === null ? (
          <Muted>—</Muted>
        ) : (
          <span title="Earliest recorded round or offer date">
            {formatDate(row.date)}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Companies"
        description={`${formatCount(result.reportedRows)} of ${formatCount(
          result.total,
        )} company/cycle rows for ${batchYear} include student submissions. Historical headcounts use the same offer format and are labelled by source.`}
      />

      <FilterBar
        facets={[
          {
            param: "tier",
            label: "Tier",
            options: result.facets.tiers.map((tier) => ({
              key: tier.key,
              label: tier.label,
              count: tier.count,
            })),
          },
          {
            param: "branch",
            label: "Branch",
            options: result.facets.branches.map((branch) => ({
              key: branch.key,
              label: branch.key,
              count: branch.count,
            })),
          },
          {
            param: "cycle",
            label: "Cycle",
            options: result.facets.cycles.map((cycle) => ({
              key: cycle.key,
              label: CYCLE_LABELS[cycle.key] ?? cycle.key,
              count: cycle.count,
            })),
          },
          {
            param: "source",
            label: "Source",
            options: result.facets.sources.map((source) => ({
              key: source.key,
              label: SOURCE[source.key]?.label ?? source.key,
              count: source.count,
            })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={result.rows}
        rowKey={(row) => row.key}
        rowHref={(row) => `/companies/${row.companySlug}?batch=${batchYear}`}
        query={tableQuery}
        empty={
          <EmptyState
            title="No companies match these filters"
            description="Try removing a filter, or search for a company by any name it has been recorded under."
          />
        }
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        query={tableQuery}
      />
    </>
  );
}

function Muted({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{ color: "var(--text-tertiary)" }}>
      {children}
    </span>
  );
}
