"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: "var(--color-accent-600)" }}
    >
      {pending ? "Checking with PESU…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1.5">
        <label htmlFor="username" className="block text-sm font-medium">
          SRN or PRN
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          placeholder="PES1UG23CS001"
          aria-describedby={state.error ? "login-error" : undefined}
          className="h-11 w-full rounded-lg border px-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-500)]"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">
          PESU password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={state.error ? "login-error" : undefined}
          className="h-11 w-full rounded-lg border px-3 text-sm outline-none transition-colors focus:border-[var(--color-accent-500)]"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
      </div>

      {state.error ? (
        <p
          id="login-error"
          role="alert"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: "color-mix(in oklch, red 30%, var(--border))",
            color: "color-mix(in oklch, red 55%, var(--text))",
          }}
        >
          {state.error}
          {state.retryable ? (
            <span className="mt-1 block text-xs opacity-80">
              The PESU service sleeps when idle and can take a few seconds to
              wake up.
            </span>
          ) : null}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
