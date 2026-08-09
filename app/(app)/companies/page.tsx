import Link from "next/link";
import { requireStudent } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { queryDirectory, SORT_KEYS, type SortKey } from "@/lib/analytics/directory";
import { FilterBar } from "@/components/data/filter-bar";
import { DataTable, Pagination, type Column } from "@/components/data/table";
import type { DirectoryRow } from "@/lib/analytics/directory";
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  Tag,
  formatCompactInr,
  formatCount,
  formatDate,
  formatLpa,
  type Tone,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies · PESU Placement Tracker" };

const SOURCE: Record<string, { label: string; tone: Tone }> = {
  students: { label: "Reported", tone: "accent" },
  imported: { label: "Imported only", tone: "neutral" },
};

const CYCLE: Record<string, string> = {
  SUMMER_INTERNSHIP: "Summer",
  SIX_MONTH_INTERNSHIP: "Internship",
  FULL_TIME: "Full time",
};

const TIER_LABEL: Record<string, string> = {
  TIER_1: "T1",
  TIER_2: "T2",
  TIER_3: "T3",
};

function list(value: string | undefined): string[] | undefined {
  const parts = value?.split(",").filter(Boolean);
  return parts && parts.length > 0 ? parts : undefined;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const student = await requireStudent("/companies");
  const params = await searchParams;

  const batches = await prisma.batch.findMany({ orderBy: { year: "desc" }, select: { year: true } });
  const requested = Number.parseInt(params["batch"] ?? "", 10);
  const batchYear =
    batches.find((batch) => batch.year === requested)?.year ??
    student.graduationYear ??
    batches[0]?.year ??
    new Date().getFullYear();

  const sortParam = params["sort"];
  const sort = (SORT_KEYS as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as SortKey)
    : "reports";

  const result = await queryDirectory({
    batchYear,
    search: params["q"],
    tierKeys: list(params["tier"]),
    branchCodes: list(params["branch"]),
    cycles: list(params["cycle"]) as never,
    sources: list(params["source"]) as never,
    sort,
    direction: params["dir"] === "asc" ? "asc" : "desc",
    page: Number.parseInt(params["page"] ?? "1", 10) || 1,
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
          {row.isRepeatVisit ? <Tag title="Returned during the same season">2nd visit</Tag> : null}
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
        <span style={{ color: "var(--text-secondary)" }}>{CYCLE[row.cycle] ?? row.cycle}</span>
      ),
    },
    {
      key: "source",
      header: "Source",
      hideBelow: "sm",
      render: (row) => {
        const source = SOURCE[row.reports > 0 ? "students" : "imported"]!;
        return <StatusBadge tone={source.tone}>{source.label}</StatusBadge>;
      },
    },
    {
      key: "reports",
      header: "Reports",
      sortKey: "reports",
      numeric: true,
      width: "88px",
      render: (row) =>
        row.reports > 0 ? (
          formatCount(row.reports)
        ) : row.importedPlaced ? (
          <Muted title={`${row.importedPlaced} in the imported records; nobody has filed here`}>
            ({formatCount(row.importedPlaced)})
          </Muted>
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      key: "stipend",
      header: "Stipend",
      sortKey: "stipend",
      numeric: true,
      width: "92px",
      hideBelow: "lg",
      render: (row) =>
        row.highestStipendInr ? formatCompactInr(row.highestStipendInr) : <Muted>—</Muted>,
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
      header: "Cash yr 1",
      numeric: true,
      width: "96px",
      hideBelow: "lg",
      render: (row) =>
        row.firstYearCashLpa === null ? (
          <Muted>—</Muted>
        ) : (
          <span
            title="Cash actually reaching the student in year one, excluding unvested equity and non-cash benefits"
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
          <span
            title={
              row.cutoffSource === "students"
                ? `Announced cutoff, as students reported it${
                    row.cgpaCutoffLabel ? ` (${row.cgpaCutoffLabel})` : ""
                  }`
                : `From the imported records: ${row.cgpaCutoffLabel}`
            }
            style={{ color: row.cutoffSource === "imported" ? "var(--text-tertiary)" : undefined }}
          >
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
          <span
            title={
              row.dateSource === "students"
                ? "Earliest round or offer date a student reported"
                : "Pre-placement talk, from the imported records"
            }
            style={{ color: row.dateSource === "imported" ? "var(--text-tertiary)" : undefined }}
          >
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
        )} rows for the batch of ${batchYear} have student reports behind them; the rest are imported records, shown greyed. Filters and sorting live in the address bar, so any view here is a link you can send someone.`}
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
              label: CYCLE[cycle.key] ?? cycle.key,
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
