import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import type { Prisma } from "@/generated/prisma/client";
import {
  Button,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/ui/primitives";
import { DataTable, Pagination, type Column } from "@/components/data/table";
import { FilterBar } from "@/components/data/filter-bar";
import { formatLpa } from "@/lib/format";
import {
  positiveInteger,
  singleParams,
  type SearchParams,
} from "@/lib/query-params";

export default async function AdminOffersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN");
  const params = singleParams(await searchParams);
  const page = Math.min(positiveInteger(params.page), 10000),
    year = Number(params.batch),
    q = (params.q ?? "").slice(0, 160);
  const where: Prisma.OfferWhereInput = {
    ...(Number.isInteger(year) && year >= 2000 && year <= 9999
      ? { batch: { year } }
      : {}),
    ...(params.status === "removed"
      ? { deletedAt: { not: null } }
      : params.status === "all"
        ? {}
        : { deletedAt: null }),
    ...(q
      ? {
          OR: [
            { company: { name: { contains: q, mode: "insensitive" } } },
            { roleTitle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const direction = params.dir === "asc" ? ("asc" as const) : ("desc" as const);
  const orderBy: Prisma.OfferOrderByWithRelationInput =
    params.sort === "company"
      ? { company: { name: direction } }
      : params.sort === "batch"
        ? { batch: { year: direction } }
        : params.sort === "ctc"
          ? { compensation: { ctcLpa: direction } }
          : { updatedAt: direction };
  const [rows, total] = await Promise.all([
    prisma.offer.findMany({
      where,
      include: {
        company: { select: { name: true } },
        batch: { select: { year: true } },
        compensation: { select: { ctcLpa: true } },
      },
      orderBy: [orderBy, { id: "asc" }],
      take: 50,
      skip: (page - 1) * 50,
    }),
    prisma.offer.count({ where }),
  ]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    {
      key: "company",
      header: "Company / role",
      sortKey: "company",
      render: (row) => (
        <>
          <span className="font-medium">{row.company.name}</span>
          <span className="ml-2" style={{ color: "var(--text-tertiary)" }}>
            {row.roleTitle}
          </span>
        </>
      ),
    },
    {
      key: "batch",
      header: "Batch",
      sortKey: "batch",
      render: (row) => row.batch.year,
    },
    {
      key: "ctc",
      header: "CTC",
      sortKey: "ctc",
      numeric: true,
      render: (row) =>
        formatLpa(
          row.compensation?.ctcLpa == null
            ? null
            : Number(row.compensation.ctcLpa),
        ),
    },
    {
      key: "source",
      header: "Source",
      hideBelow: "md",
      render: (row) =>
        row.source === "SELF_REPORTED"
          ? "Student"
          : row.source === "OFFICIAL_IMPORT"
            ? "Spreadsheet"
            : "Admin",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge tone={row.deletedAt ? "warning" : "good"}>
          {row.yieldedToId
            ? "Yielded to student"
            : row.deletedAt
              ? "Removed"
              : row.verification === "ADMIN_VERIFIED"
                ? "Verified"
                : "Active"}
        </StatusBadge>
      ),
    },
  ];
  const query = { pathname: "/admin/offers", params };
  return (
    <>
      <PageHeader
        title="Placement outcomes"
        description={`${total.toLocaleString("en-IN")} outcomes. Edits keep a snapshot; removal is reversible.`}
        actions={
          <Button
            href={`/admin/offers/new${params.batch ? `?batch=${encodeURIComponent(params.batch)}` : ""}`}
            variant="primary"
          >
            Add outcomes
          </Button>
        }
      />
      <FilterBar facets={[]} searchPlaceholder="Search company or role…">
        <Button
          href={`/admin/offers?${new URLSearchParams({ ...(params.batch ? { batch: params.batch } : {}), status: params.status === "all" ? "active" : "all" })}`}
          size="sm"
        >
          {params.status === "all" ? "Show active" : "Include removed"}
        </Button>
      </FilterBar>
      {rows.length ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/admin/offers/${row.id}`}
          query={query}
        />
      ) : (
        <EmptyState title="No matching outcomes" />
      )}
      <Pagination
        page={page}
        pageSize={50}
        pageCount={Math.ceil(total / 50)}
        total={total}
        query={query}
      />
    </>
  );
}
