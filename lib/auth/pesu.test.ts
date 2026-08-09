import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateWithPesu } from "./pesu";

/**
 * Regression tests for the PESU response parser.
 *
 * The bug these exist for: every profile field is `str | None` upstream and the
 * response is serialised with `exclude_none=True`, so a field PESU could not
 * scrape is ABSENT rather than null. The parser required `name` and `srn`, so a
 * successful login with an incomplete profile was rejected as an "unexpected
 * response" — a failure only reachable with a CORRECT password, and therefore
 * invisible to any test one can safely write by hand.
 */

/**
 * A deliberately impossible SRN. PESU issues three-digit serials, so a
 * four-digit one starting at 9001 cannot belong to a real student — which
 * matters in a public repository, where a realistic-looking fixture is
 * indistinguishable from someone's actual identifier.
 */
const SRN = "PES2UG24CS9001";

const ORIGINAL_FETCH = globalThis.fetch;

function mockResponse(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("authenticateWithPesu", () => {
  it("accepts a successful login whose profile omits every optional field", async () => {
    globalThis.fetch = mockResponse({
      status: true,
      message: "Login successful.",
      timestamp: "2026-08-09T13:00:00+05:30",
      profile: { srn: SRN },
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.srn).toBe(SRN);
      // With no name upstream, the SRN stands in rather than the login failing.
      expect(result.profile.name).toBe(SRN);
    }
  });

  it("accepts a full profile unchanged", async () => {
    globalThis.fetch = mockResponse({
      status: true,
      message: "Login successful.",
      timestamp: "2026-08-09T13:00:00+05:30",
      profile: {
        name: "A Student",
        srn: SRN,
        prn: "PES2202409001",
        program: "Bachelor of Technology",
        branch: "Computer Science and Engineering",
        semester: "5",
        section: "B",
        email: "a@example.com",
        phone: "9999999999",
        campusCode: 2,
        campus: "EC",
      },
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.name).toBe("A Student");
      expect(result.profile.campusCode).toBe(2);
    }
  });

  it("falls back to the typed SRN when the profile omits it", async () => {
    globalThis.fetch = mockResponse({
      status: true,
      message: "Login successful.",
      timestamp: "2026-08-09T13:00:00+05:30",
      profile: { name: "A Student" },
    }) as never;

    const result = await authenticateWithPesu(SRN.toLowerCase(), "irrelevant");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.srn).toBe(SRN);
  });

  it("refuses to invent an SRN from an e-mail login", async () => {
    globalThis.fetch = mockResponse({
      status: true,
      message: "Login successful.",
      timestamp: "2026-08-09T13:00:00+05:30",
      profile: { name: "A Student" },
    }) as never;

    const result = await authenticateWithPesu("someone@example.com", "irrelevant");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("UNEXPECTED_RESPONSE");
      expect(result.message).toMatch(/signing in with your SRN/i);
    }
  });

  it("reports a wrong password as a wrong password", async () => {
    globalThis.fetch = mockResponse(
      { status: false, message: "Invalid username or password.", timestamp: "x" },
      401,
    ) as never;

    const result = await authenticateWithPesu(SRN, "wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_CREDENTIALS");
  });

  it("blames itself, not the student, when the service rejects our request", async () => {
    globalThis.fetch = mockResponse({ detail: "validation error" }, 422) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("BAD_REQUEST");
      expect(result.message).toMatch(/bug here, not a problem with your account/i);
    }
  });

  it("treats an authenticated-but-profileless reply as a service problem", async () => {
    globalThis.fetch = mockResponse({
      status: true,
      message: "Login successful.",
      timestamp: "x",
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SERVICE_UNAVAILABLE");
      expect(result.message).not.toMatch(/incorrect/i);
    }
  });

  it("retries a 502 and succeeds on the second attempt", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("bad gateway", { status: 502 });
      return new Response(
        JSON.stringify({
          status: true,
          message: "Login successful.",
          timestamp: "x",
          profile: { srn: SRN, name: "A Student" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(call).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("drops the class-and-section scrape on the final attempt", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length < 3) return new Response("bad gateway", { status: 502 });
      return new Response(
        JSON.stringify({
          status: true,
          message: "Login successful.",
          timestamp: "x",
          profile: { srn: SRN, name: "A Student" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(result.ok).toBe(true);
    // The expensive second scrape is what tips a successful login past the
    // gateway timeout, so the last attempt asks for the profile alone.
    expect(bodies.map((body) => body["knowYourClassAndSection"])).toEqual([true, true, false]);
  });

  it("gives up after three gateway failures and does not blame the password", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return new Response("bad gateway", { status: 502 });
    }) as never;

    const result = await authenticateWithPesu(SRN, "irrelevant");
    expect(call).toBe(3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("SERVICE_UNAVAILABLE");
      expect(result.message).toMatch(/gateway error/i);
      expect(result.message).not.toMatch(/incorrect|password/i);
    }
  });

  it("does not retry a wrong password", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({ status: false, message: "no", timestamp: "x" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as never;

    const result = await authenticateWithPesu(SRN, "wrong");
    // Retrying a rejected credential would burn the account's rate limit for
    // no possible gain.
    expect(call).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("never puts the password in the returned message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as never;

    const result = await authenticateWithPesu(SRN, "a-secret-value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result)).not.toContain("a-secret-value");
  });
});
