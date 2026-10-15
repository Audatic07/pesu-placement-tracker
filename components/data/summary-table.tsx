import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/primitives";

export function SummaryTable({
  head,
  rows,
}: {
  head: string[];
  rows: Array<{ key: string; href?: string; cells: ReactNode[] }>;
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
                scope="col"
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
                  key={head[index]}
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
