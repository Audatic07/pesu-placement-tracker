import "server-only";
import { z } from "zod";

// Passwords are forwarded to PESU over HTTPS and never persisted or logged.
// Upstream profile fields may be absent when PESU cannot scrape them.
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
  // Two bounded attempts leave time for provisioning within the 60-second action.
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25_000) : 25_000;
}

/** Gateway errors from the host, not answers from the service. Worth retrying. */
const TRANSIENT_STATUSES = new Set([502, 503, 504, 520, 521, 522, 524]);

/**
 * Tests disable retry backoff; production waits one second between attempts.
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
  const attempts = [0, 1_000];

  let response: Response | null = null;
  let lastTransient = "";

  for (const [index, attempt] of attempts.entries()) {
    const backoff = attempt * backoffScale();
    if (backoff > 0) await sleep(backoff);

    try {
      response = await fetch(`${baseUrl()}/authenticate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          profile: true,
          fields: ["name", "prn", "srn", "program", "branch", "semester", "section", "campusCode"],
        }),
        signal: AbortSignal.timeout(timeoutMs()),
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
            ? "PESU did not respond in time, across two attempts. It is slow when it has been idle — wait a minute and try once more."
            : "Could not reach the PESU authentication service. Check your connection and try again.",
      };
    }

    // A gateway error is the host failing, not the service answering. Retry.
    if (TRANSIENT_STATUSES.has(response.status)) {
      lastTransient = `upstream ${response.status}`;
      if (index < attempts.length - 1) continue;

      logFailure(username, "SERVICE_UNAVAILABLE", `${lastTransient}, gave up after 2 attempts`);
      return {
        ok: false,
        reason: "SERVICE_UNAVAILABLE",
        message:
          "PESU's login service failed twice in a row — its host returned a gateway error, which usually means it is overloaded rather than that anything is wrong with your account. Wait a minute and try again.",
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

  // A malformed request is an application error, not a wrong password.
  if (response.status === 400) {
    logFailure(username, "BAD_REQUEST", `service rejected our request (${response.status})`);
    return {
      ok: false,
      reason: "BAD_REQUEST",
      message:
        "This app sent the login service a request it rejected. That is a bug here, not a problem with your account — please report it.",
    };
  }

  if (response.status === 422) {
    logFailure(username, "SERVICE_UNAVAILABLE", "PESU profile could not be parsed");
    return {
      ok: false,
      reason: "SERVICE_UNAVAILABLE",
      message: "PESU's profile page could not be read. Try again shortly.",
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
  } catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      logFailure(username, "SERVICE_UNAVAILABLE", "response body timed out");
      return { ok: false, reason: "SERVICE_UNAVAILABLE", message: "PESU did not finish responding in time. Try again shortly." };
    }
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
