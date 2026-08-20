import { redirect } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Login is the slowest request this app makes, and it is slow only when it
 * succeeds: a rejected credential comes back in about four seconds, while an
 * accepted one goes on to scrape a profile. See lib/auth/pesu.ts.
 *
 * Server actions inherit the segment config of the page that invokes them, so
 * this ceiling covers `signIn`. On a serverless host the platform's own cap
 * still applies and is usually lower — 60s on Vercel Hobby — which is why
 * PESU_AUTH_TIMEOUT_MS has to leave room for a retry inside it rather than
 * being set to the largest number that looks safe.
 */
export const maxDuration = 60;

export const metadata = {
  title: "Sign in · PESU Placement Tracker",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const existing = await getCurrentStudent();
  if (existing) redirect("/");

  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          PESU Placement Tracker
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          Sign in with your PESU Academy credentials.
        </p>
      </div>

      <div
        className="mt-8 rounded-xl border p-6"
        style={{ borderColor: "rgba(255, 255, 255, 0.12)", background: "#0a0b0d" }}
      >
        <LoginForm next={next} />
      </div>

      <p
        className="mt-6 text-xs leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        Your password is checked against PESU Academy and is never stored by
        this app — not in the database, not in a log, not in any form. It is
        sent once to the PESU authentication service to confirm who you are,
        after which this app issues its own session.
      </p>
    </main>
  );
}
