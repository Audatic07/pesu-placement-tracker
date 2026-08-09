"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateWithPesu } from "@/lib/auth/pesu";
import { applyBootstrapAdmin, provisionStudent } from "@/lib/auth/provision";
import { createSession, destroySession } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

/**
 * The login server action.
 *
 * This is the only place a PESU password exists in this codebase, and it exists
 * here for the duration of one function call. It arrives in a FormData, goes
 * straight to lib/auth/pesu, and is never assigned to anything that outlives
 * the request. It is not logged, not stored, and not returned.
 *
 * Being a server action rather than a route handler matters: the credential
 * goes browser -> our server -> PESU. It never travels browser -> PESU, so no
 * CORS relaxation is needed and the password is never in a client bundle.
 */

const LoginInput = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Enter your SRN or PRN.")
    .max(64, "That does not look like an SRN or PRN."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export type LoginState = {
  error?: string;
  /** Set when the failure is upstream, so the UI can suggest retrying. */
  retryable?: boolean;
};

/** Per-account and per-IP caps. Without these the form is a brute-force oracle
 * pointed at PESU's own service, not just at us. */
const ATTEMPTS_PER_ACCOUNT = 8;
const ATTEMPTS_PER_IP = 30;
const WINDOW_SECONDS = 15 * 60;

export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const { username, password, next } = parsed.data;
  const identifier = username.toUpperCase();

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  const [accountLimit, ipLimit] = await Promise.all([
    consumeRateLimit(`login:acct:${identifier}`, ATTEMPTS_PER_ACCOUNT, WINDOW_SECONDS),
    consumeRateLimit(`login:ip:${ip}`, ATTEMPTS_PER_IP, WINDOW_SECONDS),
  ]);

  if (!accountLimit.allowed || !ipLimit.allowed) {
    const wait = Math.max(accountLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
    return {
      error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`,
    };
  }

  const result = await authenticateWithPesu(username, password);

  if (!result.ok) {
    return {
      error: result.message,
      retryable: result.reason === "SERVICE_UNAVAILABLE",
    };
  }

  const student = await provisionStudent(result.profile, result.classInfo);

  if (student.isSuspended) {
    return {
      error:
        student.suspendedReason ??
        "This account has been suspended. Contact the placement tracker admins.",
    };
  }

  const withRole = await applyBootstrapAdmin(student);

  await createSession({
    sub: withRole.id,
    srn: withRole.srn,
    role: withRole.role,
  });

  await recordAudit({
    actorId: withRole.id,
    action: "LOGIN",
    entityType: "Student",
    entityId: withRole.id,
    summary: `${withRole.srn} signed in.`,
  });

  // Only same-origin paths, so a crafted ?next= cannot bounce someone to
  // another site carrying the impression that we sent them there.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(destination);
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
