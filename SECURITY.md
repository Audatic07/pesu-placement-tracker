# Security policy

This application authenticates students against PESU Academy and stores their
self-reported placement data. A vulnerability here exposes real people, so
please report privately rather than opening a public issue.

## Reporting

Use GitHub's **Report a vulnerability** button on the Security tab of this
repository, which opens a private advisory. If that is unavailable, contact the
repository owner directly.

Please include what you did, what happened, and what you expected. A working
proof of concept helps, but do not test against the production deployment with
anyone's account but your own, and do not exfiltrate data belonging to other
students in order to demonstrate a finding — a single record you already have
access to is enough to make the point.

Expect an acknowledgement within a week. This is maintained by students during
a placement season; that is slower than a company, and it is the honest number.

## What matters most here

Ranked by how badly it goes wrong, not by how interesting the bug is:

1. **Any path that reveals an individual student's package, CGPA or identity**
   from what is supposed to be an aggregate. This includes small-cohort
   inference: if a filter combination narrows to one person, the answer must be
   suppressed rather than shown. The gate is `lib/privacy/gate.ts`.
2. **Anything touching the PESU password.** It passes through the server once
   and is never stored, logged or cached. A path that writes it anywhere — an
   error log, a trace, a retry buffer — is critical.
3. **Session forgery or fixation.** Sessions are HS256 JWTs in an httpOnly
   cookie, signed with `SESSION_SECRET`, verified on every guarded request with
   the role re-read from the database rather than trusted from the token.
4. **Privilege escalation into the admin console**, or moderation actions taken
   without an audit entry.
5. **Submission integrity** — writing an offer as another student, forging a
   tier the package does not support, or evading the per-batch quota.

## What is out of scope

- Findings against `pesu-auth` itself. Report those to
  [pesu-dev/auth](https://github.com/pesu-dev/auth).
- The rate limiter failing open when the database is unreachable. That is a
  deliberate trade documented in `lib/rate-limit.ts`: it is a guard rail, not
  the security boundary.
- The demo batch (9998) containing implausible data. It is synthetic by design
  and contains no real person's record.
- `npm run demo:login` minting a session. It requires `SESSION_SECRET` and
  direct database access — anyone holding both already controls the deployment —
  and it refuses to run in production.
- Missing hardening that has no exploit path, reported without one.

## If you are running your own deployment

Rotate `SESSION_SECRET` on any suspicion of a leak; it invalidates every active
session, which is the intended emergency response. Keep `PRIVACY_MIN_COHORT_SIZE`
at 5 or higher — lowering it weakens student anonymity directly, and it is the
one setting where a smaller number is never a better product.
