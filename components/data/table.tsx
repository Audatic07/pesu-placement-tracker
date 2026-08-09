import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The table.
 *
 * A server component on purpose. Sorting and paging are links, not state, so
 * none of this needs to ship JavaScript: a sorted view is a URL, the back
 * button undoes a sort, and the whole table streams as markup. An earlier
 * version made this a client component, which meant column render functions
 * had to cross the server/client boundary — they cannot, and it failed at
 * runtime rather than at build.
 *
 * Row navigation is an anchor stretched over the row by `.row-link` rather than
 * an onClick handler, so it works without JavaScript, supports middle-click and
 * "open in new tab", and lands in the tab order once per row instead of never.
 */

export type Column<T> = {
  key: string;
  header: string;
  /** Sort key written to the URL. Omit for a column that cannot be sorted. */
  sortKey?: string;
  numeric?: boolean;
  width?: string;
  /** Hide below this breakpoint so a phone shows only the columns that matter. */
  hideBelow?: "sm" | "md" | "lg";
  render: (row: T) => ReactNode;
};

export type TableQuery = {
  pathname: string;
  params: Record<string, string | undefined>;
};

const HIDE_CLASS = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

function buildHref(
  query: TableQuery,
  mutate: (params: URLSearchParams) => void,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query.params)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  mutate(params);
  const search = params.toString();
  return search ? `${query.pathname}?${search}` : query.pathname;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  query,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  query: TableQuery;
  empty?: ReactNode;
}) {
  const activeSort = query.params["sort"];
  const activeDir = query.params["dir"] === "asc" ? "asc" : "desc";

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10" style={{ background: "var(--bg)" }}>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {columns.map((column) => {
              const isActive = column.sortKey !== undefined && activeSort === column.sortKey;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width, color: "var(--text-tertiary)" }}
                  className={`h-8 whitespace-nowrap px-3 text-[11px] font-medium uppercase tracking-[0.05em] ${
                    column.numeric ? "text-right" : "text-left"
                  } ${column.hideBelow ? HIDE_CLASS[column.hideBelow] : ""}`}
                >
                  {column.sortKey ? (
                    <Link
                      href={buildHref(query, (params) => {
                        params.set("sort", column.sortKey!);
                        params.set(
                          "dir",
                          isActive && activeDir === "desc" ? "asc" : "desc",
                        );
                        params.delete("page");
                      })}
                      scroll={false}
                      className={`inline-flex items-center gap-1 hover:text-[var(--text)] ${
                        column.numeric ? "flex-row-reverse" : ""
                      }`}
                      style={{ color: isActive ? "var(--text)" : undefined }}
                    >
                      {column.header}
                      {isActive ? (
                        activeDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                      ) : null}
                    </Link>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={rowKey(row)}
                className="table-row-hover relative"
                style={{ borderBottom: "1px solid var(--line)" }}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`h-[38px] px-3 align-middle ${
                      column.numeric ? "tnum text-right" : "text-left"
                    } ${column.hideBelow ? HIDE_CLASS[column.hideBelow] : ""}`}
                  >
                    {index === 0 && href ? (
                      <Link href={href} className="row-link">
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  query,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  query: TableQuery;
}) {
  const hrefFor = (target: number) =>
    buildHref(query, (params) => {
      if (target <= 1) params.delete("page");
      else params.set("page", String(target));
    });

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-between gap-4 border-t px-6 py-2.5 text-[12px]"
      style={{ borderColor: "var(--line)", color: "var(--text-tertiary)" }}
    >
      <span className="tnum">
        {first}–{last} of {total.toLocaleString("en-IN")}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <PageLink href={hrefFor(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft size={14} />
          </PageLink>
          <span className="tnum px-2">
            {page} / {pageCount}
          </span>
          <PageLink href={hrefFor(page + 1)} disabled={page >= pageCount} label="Next page">
            <ChevronRight size={14} />
          </PageLink>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        aria-label={label}
        className="inline-flex size-6 items-center justify-center rounded opacity-35"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className="inline-flex size-6 items-center justify-center rounded"
      style={{ boxShadow: "inset 0 0 0 1px var(--line-strong)", color: "var(--text-secondary)" }}
    >
      {children}
    </Link>
  );
}
