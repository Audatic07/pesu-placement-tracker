# Deploying

This is a Next.js app with a PostgreSQL database and one external dependency
(the PESU authentication service). It has no queue, no cache, no object storage
and no cron — deliberately, because it has to be operable by whoever inherits it.

## Environment

Every variable is documented in [.env.example](.env.example). The four that
matter in production:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Managed Postgres, **pooled** endpoint. Include `?sslmode=require` if your provider needs it. |
| `DIRECT_DATABASE_URL` | The same database, unpooled. Migrations use it. A transaction-mode pooler drops the advisory locks Prisma takes during a migration, so `migrate deploy` against the pooled URL hangs or fails mid-build. |
| `SESSION_SECRET` | 32+ characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Rotating it signs every active session out — the intended response to a suspected leak. |
| `PESU_AUTH_BASE_URL` | Your own pesu-auth instance. See below. |
| `SUPER_ADMIN_SRN` | The SRN promoted to `SUPER_ADMIN` on first login. Set it before anyone logs in, or nobody has admin rights. |

Leave `PRIVACY_MIN_COHORT_SIZE` at 5 or raise it. Lowering it weakens student
anonymity directly.

Do not set `IMPORT_XLSX_*` in production. The importer is a one-off run against
local copies of the source workbooks; the server never reads them.

## The auth dependency

Login proxies to [pesu-dev/auth](https://github.com/pesu-dev/auth), which
verifies credentials against PESU Academy. **Run your own instance.** The public
one at `pesu-auth.onrender.com` sits behind a free-tier gateway that returns 502
on slow requests, and the only slow request is a *successful* login — the one
that goes on to scrape a profile. The observable symptom is correct passwords
failing while wrong ones are rejected cleanly.

The image is `pesudev/pesu-auth:latest`, listening on 5000, with a `/health`
endpoint. `docker-compose.yml` shows the shape.

No credential is stored by either service. The password crosses this server once
per login and is never written down.

## Database

```bash
npm run db:deploy    # prisma migrate deploy && prisma generate
npm run seed         # idempotent; safe to re-run on every release
```

`seed` writes the configuration layer — campuses, branches, programmes, tier
boundaries, submission policy, tax slabs. It is upsert-only and keyed on natural
unique fields, so running it on each deploy is the intended pattern.

Two things in the seed are placeholders that must be reviewed before the numbers
they drive are shown to anyone as authoritative:

- **Tax slabs** are the Union Budget 2025 new-regime figures for FY 2025-26.
  Check them against the current Finance Act. They are editable rows, not code.
- **CPI** has only a base year. Real index values are deliberately not invented,
  because a fabricated series would silently corrupt every inflation-adjusted
  comparison. Until an admin enters a real series, only nominal figures are shown.

## Option A — a container

```bash
docker build -t placement-tracker .
docker run -p 3000:3000 --env-file .env placement-tracker
```

The image builds `output: "standalone"`, runs as a non-root user, and carries a
healthcheck against `/api/health`. Migrations are **not** run at startup —
running them from N concurrently starting replicas is how a schema gets
corrupted. Run them as a release step:

```bash
docker run --rm --env-file .env placement-tracker npx prisma migrate deploy
```

Fly.io, Railway, Render and Cloud Run all take this image directly. Set the
release command to the migrate line above.

## Option B — Vercel

Push the repository and set the environment variables in the project settings.

`next.config.ts` turns `output: "standalone"` OFF when `VERCEL=1`, and that is
load-bearing rather than tidiness. Vercel traces dependencies itself after the
build and reads `.next/next-server.js.nft.json`; a standalone build does not
write that file at that path, so the build compiles cleanly and then dies in
Vercel's `onBuildComplete` with an ENOENT for a file this repository never
mentions.

Two things to get right:

- The `vercel-build` script runs `prisma migrate deploy` before the build, since
  Vercel has no release phase of its own. Set `DIRECT_DATABASE_URL` or that step
  will fail against the pooler.
- Use a pooled connection string for `DATABASE_URL`. Serverless functions open a
  connection each, and the pool in `lib/db.ts` (max 10) is per instance, not
  global. Neon's pooled endpoint or Supabase's transaction pooler both work.
- Turn off preview deployments, or point them at a separate database. Otherwise
  every pull request branch migrates production during its build.

## After deploying

1. `GET /api/health` returns `{"status":"ok"}` — it checks the database, and
   answers 503 without narrating why.
2. Log in as `SUPER_ADMIN_SRN` and confirm `/admin/reports` is reachable.
3. Confirm `/overview` shows the batch you expect. A batch nobody has reported
   on shows that plainly rather than borrowing a number from another year;
   that is correct behaviour, not an error.

## Demo data on a public deployment

`npm run demo:9998` creates batch 9998. It is safe to leave on a public
instance — the students are synthetic, the company names are invented, and the
batch is never mixed into a real batch's statistics. It gives a visitor
something to look at before the season starts.

`npm run demo:login` refuses to run when `NODE_ENV=production`.

## Backups

The database is the entire product. Every offer is a thing a student typed once
and will not type again. Turn on your provider's automated backups before the
first real submission, and confirm a restore actually works before the season
starts rather than after.
