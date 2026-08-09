# Contributing

This app holds real placement data about real students, and it is meant to be
handed to a stranger every few years as its maintainers graduate. Both facts
shape what a good change looks like here.

## Getting set up

Follow the local setup in [README.md](README.md), then:

```bash
npm run demo:9998
npm run demo:login
```

You do not need a PESU account to work on this. `demo:login` mints a session for
a synthetic student; it requires `SESSION_SECRET` and direct database access, so
it is not a way in for anyone who does not already control the deployment, and
it refuses to run against a production build.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

If your change touches submission, analytics or moderation, also run:

```bash
npm run demo:9998 -- --reset
```

It prints a pass/fail line per rule and exits non-zero if any check fails. It is
the closest thing this project has to an integration suite, and it catches
things unit tests structurally cannot — a quota that stops biting at volume, an
aggregate that starts counting imported drives, a company that quietly splits
into two rows because someone typed it in lower case.

## The rules that are not negotiable

**No statistic bypasses the privacy gate.** Everything aggregate goes through
`lib/privacy/gate.ts`. `Suppressible<T>` cannot be read without handling the
suppressed case, and that is deliberate — do not unwrap it with a cast. Minimum
and maximum are suppressed with everything else, because a maximum is one
person's exact package.

**No password is stored, logged, or held longer than the request.** It passes
through the server once, to pesu-auth, and is never written anywhere. Check
`lib/auth/pesu.ts` before touching the login path.

**Nothing is hard-deleted.** Moderation soft-deletes with a reason and a
before/after snapshot. A decision that cannot be reviewed later is
indistinguishable from censorship.

**Configuration lives in the database, not in code.** Tier boundaries,
submission quotas and tax slabs are per-batch rows. If you find yourself adding
a constant that a future admin might need to change, add a column instead.

**Derived values are derived on the server.** The tier comes from the package,
the CGPA band from the CGPA, the quota check from the database. A form field is
a suggestion; the server module is the rule.

## Code shape

- Server components by default. `FilterBar` and `Sidebar` are client components
  because they genuinely need to be; a sortable column is a link, not an
  `onClick`.
- View state lives in the URL. Search, filter, sort and page are query
  parameters, so any view is a link someone can send.
- Comments explain *why*, especially where the obvious implementation was
  rejected for a reason. The existing files are the register to match.
- Match the surrounding code rather than importing a different house style.

## Design changes

[DESIGN.md](DESIGN.md) lists what the design system refuses and why, with
measured contrast ratios. [PRODUCT.md](PRODUCT.md) lists the product's
anti-goals — notably that this must not become a leaderboard. If a change
conflicts with either, make the case in the pull request rather than landing it
quietly.

## Reporting bugs

Include the batch year and the URL. Every view is URL-addressable, so the
address bar is usually a complete reproduction. Never paste real student data
into an issue.
