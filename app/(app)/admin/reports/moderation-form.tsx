"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { moderate, type ModerationState } from "./actions";

/**
 * The keep-or-remove decision.
 *
 * The note is required on a removal and optional otherwise: a removal is the
 * one action a student cannot see the reasoning for, so the reasoning has to
 * exist somewhere. It lands in the audit log either way.
 */
export function ModerationForm({
  offerId,
  restoreOnly,
}: {
  offerId: string;
  restoreOnly?: boolean;
}) {
  const [state, formAction] = useActionState<ModerationState, FormData>(moderate, {});

  if (restoreOnly) {
    return (
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="offerId" value={offerId} />
        <input type="hidden" name="action" value="RESTORE" />
        <Action label="Restore this entry" tone="neutral" />
        {state.error ? (
          <span className="text-[12px]" style={{ color: "var(--critical)" }}>
            {state.error}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <input type="hidden" name="offerId" value={offerId} />

      <input
        name="note"
        placeholder="Why (required if you remove it — this goes in the audit log)"
        className="h-[30px] w-full rounded-[var(--radius-control)] px-2 text-[13px] outline-none"
        style={{
          background: "var(--panel)",
          color: "var(--text)",
          boxShadow: "inset 0 0 0 1px var(--line-strong)",
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Action name="action" value="KEEP" label="Keep — reports rejected" tone="neutral" />
        <Action name="action" value="VERIFY" label="Keep and mark verified" tone="good" />
        <Action name="action" value="REMOVE" label="Remove" tone="critical" />
        {state.error ? (
          <span className="text-[12px]" style={{ color: "var(--critical)" }}>
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Action({
  name,
  value,
  label,
  tone,
}: {
  name?: string;
  value?: string;
  label: string;
  tone: "neutral" | "good" | "critical";
}) {
  const { pending } = useFormStatus();
  const color =
    tone === "critical" ? "var(--critical)" : tone === "good" ? "var(--good)" : "var(--text)";

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className="h-7 rounded-[var(--radius-control)] px-2.5 text-[12px] font-medium disabled:opacity-50"
      style={{ color, boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
    >
      {label}
    </button>
  );
}
