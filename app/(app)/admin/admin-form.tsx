"use client";

import Link from "next/link";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";
import type { AdminState } from "@/lib/admin/input";

export function AdminForm({
  action,
  children,
  label = "Save changes",
}: {
  action: (previous: AdminState, form: FormData) => Promise<AdminState>;
  children: ReactNode;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        {children}
      </fieldset>
      {state.error ? (
        <p
          role="alert"
          className="whitespace-pre-line text-[13px]"
          style={{ color: "var(--critical)" }}
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <output className="text-[13px]" style={{ color: "var(--good)" }}>
          {state.success}{" "}
          {state.offerId ? (
            <Link className="underline" href={`/admin/offers/${state.offerId}`}>
              Open outcome
            </Link>
          ) : null}
        </output>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </form>
  );
}
