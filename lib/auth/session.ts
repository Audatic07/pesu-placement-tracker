import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Our own session, minted after PESU has vouched for the student once.
 *
 * We do not hold a PESU session or token — the upstream service does not issue
 * one, and we would not want to store it if it did. After login the student is
 * authenticated against *us*, and PESU is not contacted again until they log
 * in afresh.
 *
 * The JWT carries only what every request needs for authorisation. Anything
 * else is read from the database, so that suspending an account or changing a
 * role takes effect on the next request rather than whenever the cookie
 * happens to expire.
 */

const COOKIE_NAME = "pt_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours

export type SessionPayload = {
  /** Student.id */
  sub: string;
  srn: string;
  role: UserRole;
};

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need >= 32 chars). Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return new TextEncoder().encode(raw);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ srn: payload.srn, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true, // unreadable from JavaScript, so XSS cannot lift it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Returns the verified session, or null. Never throws on a bad cookie. */
export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Verifies a raw token. Separate from `readSession` because middleware runs on
 * the edge runtime and reads the cookie from the request rather than via
 * `next/headers`.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.srn !== "string") {
      return null;
    }
    return {
      sub: payload.sub,
      srn: payload.srn,
      role: payload.role as UserRole,
    };
  } catch {
    // Expired, tampered with, or signed by a rotated secret. All mean the same
    // thing to the caller: there is no session.
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
