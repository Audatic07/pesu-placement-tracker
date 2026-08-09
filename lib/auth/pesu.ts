import "server-only";
import { z } from "zod";

/**
 * Client for the PESU authentication service (https://github.com/pesu-dev/auth).
 *
 * SECURITY BOUNDARY — read before editing.
 *
 * The student's PESU password passes through this module and nowhere else. It
 * arrives from a server action, is forwarded once over HTTPS, and is then
 * unreachable. Specifically, it must never be:
 *
 *   - persisted to the database, in any form, hashed or otherwise;
 *   - written to a log, an error message, or a trace;
 *   - included in a thrown error's payload;
 *   - sent from the browser to the PESU service directly.
 *
 * The third point is why every error below is constructed by hand instead of
 * re-thrown: a fetch failure can otherwise carry the request body into the
 * stack trace, and that body is a live credential.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a runtime surprise.
 */

/**
 * EVERY field here is optional, and that is not defensiveness — it is the
 * upstream contract. `ProfileModel` declares each field as `str | None`, and
 * the response is serialised with `exclude_none=True`, so any field PESU could
 * not scrape is absent from the JSON rather than null.
 *
 * An earlier version required `name` and `srn`. That parses fine for a failed
 * login (there is no profile at all) and blows up only for a SUCCESSFUL one
 * whose profile is missing a field — so the bug was invisible to every test
 * that used a wrong password, which is every test one can safely write.
 */
const PESU_PROFILE = z.object({
  name: z.string().optional(),
  prn: z.string().optional(),
  srn: z.string().optional(),
  program: z.string().optional(),
  branch: z.string().optional(),
  semester: z.string().optional(),
  section: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  campusCode: z.number().int().optional(),
  campus: z.string().optional(),
});

const PESU_RESPONSE = z.object({
  status: z.boolean(),
  profile: PESU_PROFILE.optional(),
  knowYourClassAndSection: z
    .object({
      prn: z.string().optional(),
      srn: z.string().optional(),
      name: z.string().optional(),
      semester: z.string().optional(),
      section: z.string().optional(),
      cycle: z.string().optional(),
      department: z.string().optional(),
      branch: z.string().optional(),
      instituteName: z.string().optional(),
    })
    .optional(),
  message: z.string().optional(),
  timestamp: z.string().optional(),
});

export type PesuProfile = z.infer<typeof PESU_PROFILE>;

export type PesuAuthResult =
  | { ok: true; profile: ResolvedPesuProfile; classInfo: PesuClassInfo | null }
  | { ok: false; reason: PesuFailureReason; message: string };

/**
 * A profile with the two fields the rest of the app cannot do without.
 *
 * `srn` falls back to what the student typed — PESU accepts an SRN, PRN, email
 * or phone as the username, so this is only a usable identifier when they
 * typed an SRN, and provisioning checks that before trusting it.
 */
export type ResolvedPesuProfile = PesuProfile & { srn: string; name: string };

export type PesuClassInfo = NonNullable<
  z.infer<typeof PESU_RESPONSE>["knowYourClassAndSection"]
>;

export type PesuFailureReason =
  /** The service said these credentials are wrong. */
  | "INVALID_CREDENTIALS"
  /** The service is down, cold-starting, or unreachable. Not the user's fault. */
  | "SERVICE_UNAVAILABLE"
  /** The service answered, but not in a shape we recognise. */
  | "UNEXPECTED_RESPONSE"
  /** WE sent a malformed request. A bug here, never the student's problem. */
  | "BAD_REQUEST";

/**
 * Records why a login failed, so a report of "it doesn't work" is diagnosable.
 * The username is included because it is not a secret and identifies the
 * attempt; the password is never passed to this function at all.
 */
function logFailure(username: string, reason: PesuFailureReason, detail: string): void {
  console.warn(`[pesu-auth] ${reason} for ${username}: ${detail}`);
}

function baseUrl(): string {
  const raw = process.env.PESU_AUTH_BASE_URL?.trim();
  if (!raw) {
    throw new Error("PESU_AUTH_BASE_URL is not set. See .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

function timeoutMs(): number {
  const parsed = Number.parseInt(process.env.PESU_AUTH_TIMEOUT_MS ?? "", 10);
  /*
   * A rejected login answers in about four seconds, because it stops as soon as
   * the credentials fail. A SUCCESSFUL one then scrapes the profile and, if
   * asked, the separate "know your class and section" page — several times
   * longer. The old 20s ceiling was comfortably above the failure path and
   * below the success path, which is the worst possible place for it: logins
   * only timed out when the password was right.
   */
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45_000;
}

/** Gateway errors from the host, not answers from the service. Worth retrying. */
const TRANSIENT_STATUSES = new Set([502, 503, 504, 520, 521, 522, 524]);

/**
 * Scales the retry backoff. Tests set it to 0 so a suite that exercises three
 * attempts does not spend five seconds asleep; operators can raise it if the
 * upstream is having a bad day.
 */
function backoffScale(): number {
  const parsed = Number.parseFloat(process.env.PESU_AUTH_BACKOFF_SCALE ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates a student's PESU credentials and returns their profile.
 *
 * Never throws on a failed login — an invalid password is an expected outcome,
 * not an exception. Only a missing configuration throws.
 */
export async function authenticateWithPesu(
  username: string,
  password: string,
): Promise<PesuAuthResult> {
  /*
   * Three attempts, and the last one drops `knowYourClassAndSection`.
   *
   * That flag makes the service scrape a second page after the profile, which
   * roughly doubles the work on the only path that does any — a successful
   * login. On the free tier that is what tips a request past the host's gateway
   * timeout and produces a 502, so a correct password fails while a wrong one
   * is rejected cleanly in four seconds.
   *
   * The class-and-section data is a fallback for section and branch, both of
   * which the profile already carries. Losing it to keep the login is the right
   * trade; failing the login to keep it is not.
   *
   * Retrying a POST is safe here because it is a pure credential check with no
   * side effects upstream.
   */
  const attempts = [
    { withClassInfo: true, backoffMs: 0 },
    { withClassInfo: true, backoffMs: 1_500 },
    { withClassInfo: false, backoffMs: 3_000 },
  ];

  let response: Response | null = null;
  let lastTransient = "";

  for (const [index, attempt] of attempts.entries()) {
    const backoff = attempt.backoffMs * backoffScale();
    if (backoff > 0) await sleep(backoff);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    try {
      response = await fetch(`${baseUrl()}/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          profile: true,
          knowYourClassAndSection: attempt.withClassInfo,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      // The caught error is never returned or logged in full: on a network
      // failure the request body — which holds a live password — can appear in
      // its properties. Only the error's name is safe to record.
      const kind = error instanceof Error ? error.name : "unknown";
      lastTransient = `fetch failed (${kind})`;
      response = null;

      if (index < attempts.length - 1) continue;

      logFailure(username, "SERVICE_UNAVAILABLE", lastTransient);
      return {
        ok: false,
        reason: "SERVICE_UNAVAILABLE",
        message:
          kind === "AbortError" || kind === "TimeoutError"
            ? "PESU did not respond in time, across three attempts. It is slow when it has been idle — wait a minute and try once more."
            : "Could not reach the PESU authentication service. Check your connection and try again.",
      };
    } finally {
      clearTimeout(timer);
    }

    // A gateway error is the host failing, not the service answering. Retry.
    if (TRANSIENT_STATUSES.has(response.status)) {
      lastTransient = `upstream ${response.status}${attempt.withClassInfo ? "" : " (without class info)"}`;
      if (index < attempts.length - 1) continue;

      logFailure(username, "SERVICE_UNAVAILABLE", `${lastTransient}, gave up after 3 attempts`);
      return {
        ok: false,
        reason: "SERVICE_UNAVAILABLE",
        message:
          "PESU's login service failed three times in a row — its host returned a gateway error, which usually means it is overloaded rather than that anything is wrong with your account. Wait a minute and try again.",
      };
    }

    break;
  }

  if (!response) {
    logFailure(username, "SERVICE_UNAVAILABLE", lastTransient || "no response");
    return {
      ok: false,
      reason: "SERVICE_UNAVAILABLE",
      message: "Could not reach the PESU authentication service. Try again shortly.",
    };
  }

  if (lastTransient) {
    // Recovered on a retry. Worth recording: a rising rate here is the signal
    // to stop depending on someone else's free tier and self-host.
    console.info(`[pesu-auth] recovered for ${username} after ${lastTransient}`);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "INVALID_CREDENTIALS",
      message: "Incorrect SRN/PRN or password.",
    };
  }

  // A 400 or 422 means WE sent something the service rejected. That is a bug in
  // this app, and telling the student their password is wrong would send them
  // off to reset a password that was never the problem.
  if (response.status === 400 || response.status === 422) {
    logFailure(username, "BAD_REQUEST", `service rejected our request (${response.status})`);
    return {
      ok: false,
      reason: "BAD_REQUEST",
      message:
        "This app sent the login service a request it rejected. That is a bug here, not a problem with your account — please report it.",
    };
  }

  if (!response.ok && response.status >= 500) {
    logFailure(username, "SERVICE_UNAVAILABLE", `upstream ${response.status}`);
    return {
      ok: false,
      reason: "SERVICE_UNAVAILABLE",
      message: "The PESU authentication service is having trouble. Try again shortly.",
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    logFailure(username, "UNEXPECTED_RESPONSE", `body was not JSON (HTTP ${response.status})`);
    return {
      ok: false,
      reason: "UNEXPECTED_RESPONSE",
      message: "The PESU authentication service returned something unreadable.",
    };
  }

  const parsed = PESU_RESPONSE.safeParse(payload);
  if (!parsed.success) {
    // Log which FIELDS failed, never their values — a profile carries a real
    // name, e-mail and phone number.
    logFailure(
      username,
      "UNEXPECTED_RESPONSE",
      `response did not match the expected shape at: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
    return {
      ok: false,
      reason: "UNEXPECTED_RESPONSE",
      message:
        "The PESU authentication service replied in a form this app did not expect. It may have changed — please report it.",
    };
  }

  const data = parsed.data;

  if (!data.status) {
    return {
      ok: false,
      reason: "INVALID_CREDENTIALS",
      message: data.message ?? "Incorrect SRN/PRN or password.",
    };
  }

  if (!data.profile) {
    // status:true with no profile means the credentials were fine but the
    // upstream scrape failed. Retrying may well work, and telling the student
    // their password is wrong would be a lie.
    logFailure(username, "SERVICE_UNAVAILABLE", "authenticated but no profile returned");
    return {
      ok: false,
      reason: "SERVICE_UNAVAILABLE",
      message:
        "Your credentials were accepted, but PESU did not return your profile. Try again in a moment.",
    };
  }

  // Fill the two fields the app cannot work without. PESU omits any field it
  // could not scrape, and a login that succeeded should not be thrown away
  // because the name was missing.
  const srn = data.profile.srn?.trim() || fallbackSrn(username);
  if (!srn) {
    logFailure(username, "UNEXPECTED_RESPONSE", "no SRN in the profile and none derivable");
    return {
      ok: false,
      reason: "UNEXPECTED_RESPONSE",
      message:
        "PESU did not return your SRN. Try signing in with your SRN rather than your e-mail or phone number.",
    };
  }

  return {
    ok: true,
    profile: {
      ...data.profile,
      srn,
      name: data.profile.name?.trim() || srn,
    },
    classInfo: data.knowYourClassAndSection ?? null,
  };
}

/** Uses the typed username as the SRN, but only if it actually looks like one. */
function fallbackSrn(username: string): string | null {
  const candidate = username.trim().toUpperCase().replace(/\s+/g, "");
  return /^PES\d(UG|PG)\d{2}[A-Z]{2,4}\d{2,4}$/.test(candidate) ? candidate : null;
}

/** Liveness probe, used by the login page to explain a slow cold start. */
export async function pesuHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
