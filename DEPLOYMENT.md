# Deployment

Keep the existing Next.js + Vercel + PostgreSQL setup. Public statistics do not
require PESU login. PESU-auth is used when students submit or manage offers.

## Existing services

| Service | Location |
| --- | --- |
| Public site | https://pesu-placement-tracker.vercel.app/ |
| Vercel project | https://vercel.com/aditya-shrivastavs-projects-5cc9db2f/pesu-placement-tracker |
| PESU-auth service dashboard | https://dashboard.render.com/web/srv-d9sc8regekts73fpptp0 |
| Repository | https://github.com/Audatic07/pesu-placement-tracker |
| PostgreSQL provider | Recovery pending; Vercel has `DATABASE_URL` and `DIRECT_DATABASE_URL` secrets but no attached storage integration. |

These locations were checked on 9 October 2026. Keep credentials in the provider
and a password manager, never in this file. A localhost database is a development
instance and must not be mistaken for production.

## Configuration

Use Node.js 22. Set these in Vercel's **Production** environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing Postgres pooled endpoint, for application requests. |
| `DIRECT_DATABASE_URL` | Unpooled endpoint to the same database, for migrations. |
| `SESSION_SECRET` | At least 32 random characters, for session signatures. |
| `PESU_AUTH_BASE_URL` | HTTPS URL of the existing PESU-auth service. |
| `SUPER_ADMIN_SRN` | Account allowed to administer the app. |
| `PESU_AUTH_TIMEOUT_MS` | Optional, default/max 25000 ms per attempt. Two attempts fit the login action's 60-second budget. |
| `PRIVACY_MIN_COHORT_SIZE` | Keep at 5 or higher. |

Preview deployments must have a separate database and session secret. Never
copy production database credentials into a pull request preview.

## Release

Builds do not mutate the database. `vercel-build` only builds Next.js; this also
means preview builds cannot migrate production accidentally.

1. Run lint, typecheck, tests and a production build on Node.js 22.
2. Take a database backup and confirm which database the release will update.
3. Load the production URLs securely into the release environment and run
   `npm run db:deploy` once, before deploying code that uses the new schema.
4. For this historical-data release, write and verify the prepared ordinary
   submissions before deploying the unified analytics. The updated pages no
   longer use the legacy spreadsheet aggregate tables.
5. Deploy the reviewed commit through the existing Vercel Git integration.
6. Check `/api/health`, public `/overview`, and protected `/submit`. Confirm a
   test submission changes `/api/data-version` and another open dashboard
   refreshes automatically.

Run `npm run seed` only when initializing a new database or deliberately
restoring default configuration. It updates tier and tax rows and can overwrite
administrator changes; it is not a routine release command.

For historical data, hand-prepared entries belong in `Offer` and
`CompensationPackage`, using the same fields and analytics as student
submissions. Retain provenance in the entry's notes. Expand each stated
headcount into anonymous records with null student identity and personal CGPA.
Preserve unknown acceptance decisions, and do not count conditional FTE packages
as awarded salaries. Verify counts and amounts before deleting batch 9998 or
redundant spreadsheet aggregates; preserve genuine student submissions.

## Performance and free hosting

Batch observations and company directory rows use Next.js's data cache. A
PostgreSQL trigger increments a batch revision when an offer, compensation
package or component changes. Subsequent queries use the new revision, so a
completed submission becomes visible without a redeploy or waiting for the
five-minute cache expiry. Runtime connection pools are limited to five
connections per process; use the provider's pooled endpoint in production.

Visible aggregate pages check a small public revision endpoint every 15–30
seconds, with a five-second CDN cache. They refresh when it changes, pause
checks while hidden, and back off on errors. This is automatic near-live
refresh; it does not open a persistent connection per student.

50 concurrent users is a peak capacity target, not a promise about monthly
traffic. At 50 visible dashboards for one hour each day, 15–30-second polling
uses approximately 180,000–360,000 requests a month before normal navigation.
50 continuously visible dashboards would exceed the current free CDN request
allowance. Check actual traffic and Vercel usage before choosing a faster poll
interval or another hosting provider.

[Vercel Hobby](https://vercel.com/docs/plans/hobby) currently includes one million
CDN requests, one million function invocations, four active CPU hours and
360 GB-hours of function memory per month. Exceeding allowances can pause
service. These are allowances, not an availability guarantee.

[Render's free web services](https://render.com/docs/free) sleep after 15 minutes
without traffic and take about a minute to wake. The existing PESU-auth service
can therefore delay a first login even when browsing statistics is fast.
Requesting only the needed profile fields reduces scraping work but does not
remove that host's cold start. No free provider guarantees 24/7 operation forever.

Keep the services in their existing regions until the database provider and
region are recovered. Co-locating the Vercel function and database can help;
moving either without that information would be speculative.

## Local development

Use `.env.example`, then:

```bash
npm ci
npm run db:up
npm run db:migrate
npm run seed
npm run dev
```

PESU-auth runs in the existing Docker Compose service. Historical workbooks are
read offline and never accessed by a web request. Synthetic login cookies are
only for disposable localhost tests; they are never production credentials.
