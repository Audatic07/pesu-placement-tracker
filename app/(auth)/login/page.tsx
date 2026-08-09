import { redirect } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/rbac";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

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
        style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
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
