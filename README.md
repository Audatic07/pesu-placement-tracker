# PESU Placement Tracker

Placement statistics for PES University, built from what students report about
their own offers, authenticated with their own PESU Academy credentials.

It replaces a set of student-maintained Google Sheets that had become the
de-facto record of who hired whom, for how much, and what the process was like.
Those sheets go stale the moment their maintainer graduates. This does not: the
aggregate picture is assembled from individual submissions, so it stays true as
long as students keep filing.

## What makes it different from a spreadsheet

**Compensation is structured, not a single number.** The source sheets record
one recruiter at 60 LPA with a note that most of the excess is a retention bonus
paid over four to five years, and another at 26 LPA of which 8 lakhs is meals
and transport. The app separates headline CTC, first-year cash, recurring cash
and an estimated take-home, and shows the gap between them.

**One live source, one archive, never averaged together.** Every batch figure
counts one row per person who filed. Imported spreadsheet history is aggregate —
it records that a company placed 88 students, but not who, and at a package the
company advertised rather than one anyone confirmed receiving. Mixing the two
would answer "what did students get" with "what did companies publish", so the
archive is shown beside live figures and labelled, never summed into them.

**Anonymity is structural, not a checkbox.** Offers are anonymous by default,
exact CGPA is banded in public views, and no statistic is shown for a cohort
below five records — including maximums, which are one person's package wearing
a hat. The gate is enforced by the type system: a suppressible statistic cannot
be read without handling the suppressed case.

**Everything is batch-scoped configuration.** Tier boundaries, submission
quotas, tax slabs. The 2026 sheet's own guidelines already note a tier that
applied "to 2025 batch only", so none of it is compiled into the application.

## Stack

Next.js 16 (App Router, React 19), TypeScript, Prisma 7 on PostgreSQL 16,
Tailwind 4, Recharts, Vitest. Sessions are our own JWT cookie; PESU is contacted
once at login and never again.

## Running it locally

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env
```

Fill in `SESSION_SECRET` — the file tells you the command that generates one.
Then:

```bash
npm run db:up && npm run db:migrate && npm run seed
```

That starts PostgreSQL and the [pesu-auth](https://github.com/pesu-dev/auth)
service in Docker, applies migrations, and seeds the configuration layer
(campuses, branches, programmes, tier boundaries, submission policy, tax slabs).

Now populate a demo batch, because every page in this app is behind a login and
an empty database shows you nothing:

```bash
npm run demo:9998
```

That files 200 synthetic submissions from 170 synthetic students through the
real submission pipeline. See [Demo data](#demo-data) below.

```bash
npm run demo:login
npm run dev
```

`demo:login` prints a one-line snippet that signs you in as a demo student
without a PESU account. Paste it into the browser console at
`http://localhost:3000`, reload, and the app opens.

## Demo data

Two synthetic batches exist, for two different jobs. Neither is ever mixed into
a real batch's statistics — they are batches of their own, numbered where no
real cohort will reach.

| Command | Batch | What it is |
|---|---|---|
| `npm run demo:9999` | 9999 | A correctness fixture. ~35 rows, each hand-written to prove one rule, plus submissions that must be rejected. |
| `npm run demo:9998` | 9998 | A populated cohort. 200 submissions from 170 students, generated from a fixed seed. |

Add `-- --reset` to either to tear the batch down and rebuild it.

Both drive the **real** submission path rather than inserting rows. The 9998
harness encodes each submission as `FormData` exactly the way the browser posts
it, then runs it through `parseOfferForm` → the zod schema → `createOffer`,
which derives the tier from the package, re-checks the quota against the
database, computes the cash and take-home figures, flags outliers, recomputes
corroboration across everyone who reported the same drive, and writes an audit
entry. Reports go through `fileReport`. A fixture that bypasses the write path
cannot tell you the write path works.

Company names in the demo batches are invented. Attaching fabricated packages to
real employers on a public deployment would be a lie about identifiable
companies.

## Importing the historical spreadsheets

`npm run import:excel` reads the two source workbooks named in `.env`. They
contain real student placement data and are **not** in this repository, and
neither are screenshots of them. The importer is a one-off cold start: it seeds
the company list and gives each recruiter a previous-years section on its
profile. No statistic about a batch is ever computed from it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run db:up` / `db:down` | Docker Postgres + pesu-auth |
| `npm run db:migrate` | Apply migrations in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | Configuration rows (idempotent) |
| `npm run demo:9998` / `demo:9999` | Synthetic batches |
| `npm run demo:login` | Session cookie for a demo student (development only) |
| `npm run import:excel` | One-off historical import |

## Deploying

See [DEPLOYMENT.md](DEPLOYMENT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: this handles real
student data, so privacy failures are the highest-severity defect class here,
and every statistic must pass through the privacy gate rather than around it.

Security issues: see [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).

## Design and product intent

[PRODUCT.md](PRODUCT.md) records what this is for and what it refuses to be.
[DESIGN.md](DESIGN.md) records the design system as built. Read both before
proposing a change to how anything looks or reads — several of the constraints
in them are decisions, not defaults.
