"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/primitives";
import { AdminForm } from "../admin-form";
import { reviewImport, applyImport, type ImportState } from "../actions";

export function ImportForm() {
  const [state, review, pending] = useActionState<ImportState, FormData>(
    reviewImport,
    {},
  );
  return (
    <div className="space-y-5">
      <form action={review} className="space-y-3">
        <label className="block text-[12px] font-medium" htmlFor="import-file">
          CSV from Excel or Google Sheets
        </label>
        <input
          id="import-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          disabled={pending}
          className="block max-w-full text-[13px]"
        />
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          UTF-8 CSV; up to 200 rows, 500 outcomes, 500 KB. The first row must
          contain the template's column headings.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Reviewing…" : "Review import"}
        </Button>
      </form>
      {state.error ? (
        <p
          className="whitespace-pre-line text-[13px]"
          role="alert"
          style={{ color: "var(--critical)" }}
        >
          {state.error}
        </p>
      ) : null}
      {state.rows && state.csv && state.digest ? (
        <div className="space-y-4">
          <p className="text-[13px] font-medium">
            Review {state.outcomes} outcomes from {state.rows.length} rows
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr>
                  {["Batch", "Company", "Cycle", "Outcomes", "CTC (LPA)"].map(
                    (label) => (
                      <th key={label} scope="col" className="p-2">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr
                    key={row.rowId}
                    className="border-t"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <td className="p-2">{row.batch}</td>
                    <td className="p-2">{row.company}</td>
                    <td className="p-2">{row.cycle}</td>
                    <td className="p-2">{row.count}</td>
                    <td className="p-2">{row.ctc ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Blank amounts stay unknown. Outcomes are anonymous, with provenance
            and an audit trail. Matching historical outcomes yield to genuine
            student submissions.
          </p>
          <AdminForm
            key={state.digest}
            action={applyImport}
            label="Commit reviewed import"
          >
            <input type="hidden" name="csv" value={state.csv} />
            <input type="hidden" name="digest" value={state.digest} />
          </AdminForm>
        </div>
      ) : null}
    </div>
  );
}
