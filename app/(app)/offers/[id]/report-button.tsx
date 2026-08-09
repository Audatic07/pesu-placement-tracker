"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Flag } from "lucide-react";
import { reportOffer, type ReportState } from "./actions";

const REASONS = [
  { value: "INFLATED_CTC", label: "The package looks inflated" },
  { value: "FAKE_OFFER", label: "I do not think this offer is real" },
  { value: "WRONG_COMPANY", label: "Wrong company or role" },
  { value: "DUPLICATE", label: "Duplicate of another entry" },
  { value: "PRIVACY_VIOLATION", label: "It identifies someone who did not consent" },
  { value: "ABUSE", label: "Abusive or offensive content" },
  { value: "OTHER", label: "Something else" },
];

export function ReportButton({ offerId }: { offerId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ReportState, FormData>(reportOffer, {});
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[13px]"
        style={{ color: "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
      >
        <Flag size={13} />
        Report
      </button>

      {state.ok ? (
        <span className="text-[12px]" style={{ color: "var(--good)" }}>
          Reported — an admin will look at it.
        </span>
      ) : null}

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-panel)] border p-0 backdrop:bg-black/50"
        style={{
          borderColor: "var(--line-strong)",
          background: "var(--overlay)",
          color: "var(--text)",
          boxShadow: "var(--shadow-overlay)",
        }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="offerId" value={offerId} />

          <div>
            <h2 className="text-[14px] font-semibold">Report this entry</h2>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              This goes to the admins, not to the person who submitted it. Your name is never shown
              to them. Nothing is removed automatically — a person reads every report.
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">What is wrong?</span>
            <select
              name="reason"
              required
              className="h-[30px] rounded-[var(--radius-control)] px-2 text-[13px] outline-none"
              style={{
                background: "var(--panel)",
                color: "var(--text)",
                boxShadow: "inset 0 0 0 1px var(--line-strong)",
              }}
            >
              {REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Anything that would help (optional)</span>
            <textarea
              name="details"
              rows={3}
              placeholder="What makes you think so?"
              className="rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] outline-none"
              style={{
                background: "var(--panel)",
                color: "var(--text)",
                boxShadow: "inset 0 0 0 1px var(--line-strong)",
              }}
            />
          </label>

          {state.error ? (
            <p role="alert" className="text-[12px]" style={{ color: "var(--critical)" }}>
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 rounded-[var(--radius-control)] px-3 text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <SubmitReport />
          </div>
        </form>
      </dialog>
    </>
  );
}

function SubmitReport() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-[var(--radius-control)] px-3 text-[13px] font-medium disabled:opacity-60"
      style={{ background: "var(--accent-solid)", color: "var(--accent-fg)" }}
    >
      {pending ? "Sending…" : "Send report"}
    </button>
  );
}
