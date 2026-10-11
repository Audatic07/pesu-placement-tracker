"use client";

import { useActionState, useState } from "react";
import type { AdminState } from "@/lib/admin/input";
import { Button } from "@/components/ui/primitives";
import { AdminForm } from "../admin-form";
import { applyArchive, reviewArchive, type ArchiveState } from "./actions";

export function ArchiveForm() {
  // Keep the selected File on the client across React's automatic form reset.
  // Review returns only counts and a digest, never a copy of the archive.
  const [file, setFile] = useState<File | null>(null);
  const [reviewedFile, setReviewedFile] = useState<File | null>(null);
  async function reviewSelected(previous: ArchiveState, form: FormData) {
    const selected = file;
    const result = await reviewArchive(previous, form);
    setReviewedFile(result.summary ? selected : null);
    return result;
  }
  async function importSelected(previous: AdminState, form: FormData) {
    if (reviewedFile) form.set("file", reviewedFile);
    return applyArchive(previous, form);
  }
  const [state, review, pending] = useActionState<ArchiveState, FormData>(
    reviewSelected,
    {},
  );
  return (
    <div className="space-y-5">
      <form action={review} className="space-y-3">
        <label className="block text-[12px] font-medium" htmlFor="archive-file">
          Prepared placement archive
        </label>
        <input
          id="archive-file"
          name="file"
          type="file"
          accept=".json.gz,application/gzip"
          required
          disabled={pending}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setReviewedFile(null);
          }}
          className="block max-w-full text-[13px]"
        />
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Compressed JSON, up to 500 KB. Includes anonymous outcomes,
          compensation details, source notes and recruiting rounds.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Reviewing…" : "Review archive"}
        </Button>
      </form>
      {state.error ? (
        <p
          role="alert"
          className="text-[13px]"
          style={{ color: "var(--critical)" }}
        >
          {state.error}
        </p>
      ) : null}
      {state.summary && reviewedFile ? (
        <div className="space-y-4">
          <p className="text-[13px] font-medium">
            Review {state.summary.outcomes.toLocaleString("en-IN")} outcomes
            from {state.summary.companies} company names, with{" "}
            {state.summary.components} compensation components and{" "}
            {state.summary.rounds.toLocaleString("en-IN")} recruiting rounds.
          </p>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  Batch
                </th>
                <th scope="col" className="p-2">
                  Recorded outcomes
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(state.summary.batches).map(([year, count]) => (
                <tr
                  key={year}
                  className="border-t"
                  style={{ borderColor: "var(--line)" }}
                >
                  <td className="p-2">{year}</td>
                  <td className="p-2">{count.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            Unknown amounts and recipient details stay unknown. Counts describe
            recorded outcomes, not distinct students or a completed season.
            Existing student submissions are preserved.
          </p>
          <AdminForm
            key={state.summary.digest}
            action={importSelected}
            label="Import reviewed archive"
          >
            <input type="hidden" name="digest" value={state.summary.digest} />
          </AdminForm>
        </div>
      ) : null}
    </div>
  );
}
