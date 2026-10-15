# Deployment and handover

The application is portable Next.js + PostgreSQL. PESU-auth remains the identity
provider; admins and owners have no second application password. Provider
accounts belong to the deployment operator. Daily maintenance happens in
`/admin` using verified PESU accounts.

## Default hosting and uptime

Use Vercel Hobby for the app and the existing Neon PostgreSQL database in
Singapore. `vercel.json` places application functions in `sin1`, near the DB.
Keep the existing PESU-auth service independently of the app release. Replacing
an app deployment does not require deleting its database, auth service or domain.
Vercel and Neon are convenient defaults, not application dependencies; the
Docker image supports an ordinary Node/PostgreSQL host.

Free hosting offers a publicly addressable site within its allowances, **not an
uptime guarantee**. [Render free services](https://render.com/docs/free) sleep
after 15 idle minutes. The existing GitHub auth warm-up workflow helps, but
schedules can be delayed or disabled after inactivity. Neon can suspend idle
compute, adding wake-up latency. [Vercel Hobby](https://vercel.com/docs/plans/hobby)
can pause features when allowances are exhausted. Uninterrupted authentication
requires an always-on auth host: a paid instance or an available university or
community server. Do not promise 24/7 login availability on these free tiers.

The current database region was verified from deployment logs on 11 October
2026. Other maintainers should change `vercel.json` to match their own database.

## Production configuration

Keep credentials in the provider and a password manager. Never commit private
backups, source workbooks, credentials or real account identifiers to a fork.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled endpoint for application requests. |
| `DIRECT_DATABASE_URL` | Unpooled endpoint to the **same** DB for migrations. |
| `SESSION_SECRET` | At least 32 random characters; rotation signs everyone out. |
| `PESU_AUTH_BASE_URL` | Existing trusted PESU-auth HTTPS endpoint. |
| `SUPER_ADMIN_SRN` | Recovery owner; PESU verification is required before a grant. |
| `PRODUCTION_MIGRATIONS` | Optional `deploy`: migrate before a Vercel Production build. |
| `PESU_AUTH_TIMEOUT_MS` | Optional, maximum 25000 ms per login attempt. |
| `PRIVACY_MIN_COHORT_SIZE` | Deprecated and ignored. Every nonempty cohort is shown; recipient names stay hidden. |

**Production database credentials and session secrets belong only in Production.**
Never assign them to Preview or Development. Previews need their own database,
migrations, session secret and synthetic data. Keep Vercel fork protection
on and require reviewed code and passing CI on the production branch. Build
code can read the environment; never expose production secrets to unreviewed PRs.

## Release

1. Run `npm ci`, lint, typecheck, tests and a build on Node 22. Run the demo and
   admin integration checks against a disposable localhost database.
2. Retain a PostgreSQL backup or Neon recovery point. The owner console also
   provides a portable private logical backup.
3. Verify the pooled and direct URLs identify the intended production DB.
4. Choose a migration workflow:
   - With `PRODUCTION_MIGRATIONS=deploy`, Vercel production releases apply
     migrations before building. The script verifies both URLs identify the
     same database and refuses a pooled migration endpoint. Preview builds
     always check migration status without changing the schema.
   - Without that setting, run `npm run db:deploy` from an operator-controlled
     release environment first. Builds refuse an outdated database schema.
5. Publish the reviewed commit to the verified project and environment. Check
   `/api/health`, public `/overview`, PESU login and `/admin`. Verify a small
   admin entry and reviewed CSV import; remove test entries reversibly.
6. Confirm the public domain serves the tested release. Keep the previous
   deployment for application rollback. Do not drop migrated columns during
   application rollback.

`npm run build` never migrates. `npm run seed` is for an empty new database and
must not run on routine releases: it overwrites configured policy/tax defaults.
Production migrations are an explicit operator choice, never a PR-preview action.

## Owner recovery and handover

Set `SUPER_ADMIN_SRN` in Production to the intended owner's SRN and deploy.
After a **successful PESU login**, that account regains ownership and an
accidental suspension clears atomically with an audit entry. This does not
bypass PESU authentication or recover a lost PESU password.

Only owners manage roles at `/admin/users`. Admins manage outcomes, imports,
policies, reports and placement exports. Student offers retain their quotas.
Anonymous admin entry does not consume the administrator's personal quota or
claim that the administrator received the offers.

Keep at least two verified owners. Owners cannot remove their own access, the
last active owner cannot be removed, and the configured recovery owner cannot
be demoted or suspended through the app. For handover, grant and verify the new
owner, update the host's recovery SRN, then ask another owner to revoke the
retiring role. Transfer hosting, database and auth accounts separately.

If the database provider login is lost, recover that account or retain a private
backup through a verified owner. Do not replace an unknown database with an
empty one and assume the existing records are disposable.

## Admin operations

- `/admin/offers`: search, sort, edit and reversibly remove outcomes. Edits
  preserve complete prior offer/package snapshots and a reason. Stale edits
  fail instead of overwriting another admin's work.
- `/admin/imports`: download a template, upload UTF-8 CSV exported from Excel
  or Google Sheets, review rows/counts, then commit. Imports are atomic,
  fingerprinted and undoable; limits are 200 rows, 500 outcomes and 500 KB.
  Identical files cannot be applied twice. Changed overlapping files still
  require review because anonymous records cannot establish student identity.
- `/admin/batches`: create batches, set quotas, tier boundaries and season
  dates, and archive student entry while retaining admin correction access.
- `/admin`: database/auth diagnostics, placement exports and owner-only backups.
- `/admin/audit`: role changes, edits, import identifiers, exports and removals.

Blank compensation, acceptance decisions and dates stay unknown. Internship-only
outcomes do not count conditional FTE packages as awarded compensation. Each
stated headcount creates anonymous outcomes. Genuine student submissions
replace matching stand-ins so both are not counted. Admin and imported outcomes
are classified separately from student reports in analytics.

Years 9000 and above are reserved for synthetic demo/integration cohorts. They
remain available in the admin editor but are excluded from production batch
navigation and cannot supply policy defaults for real batches. Never import
real placement data into a reserved test year.

## Publish a historical archive

The owner-only `/admin/archive` imports a prepared, gzip-compressed JSON archive
without dropping compensation components or recruiting rounds. It requires a
private database backup downloaded by that owner within the preceding 24 hours.
Review the batch counts before committing; publication is one transaction and
receives an audit fingerprint. An identical retry is a no-op, including after
later admin corrections. A changed archive with overlapping historical batches
is refused instead of replacing existing data. Correct published outcomes in
the ordinary admin editor, which records revisions and permits soft removal.

The envelope is `{ "format": "pesu-placement-archive", "version": 1,
"expected": { "2026": 123 }, "entries": [...] }`. The strict schema in
`lib/admin/archive-schema.ts` describes every supported field. Outcomes must be
anonymous and retain source notes; recipient identity, CGPA and offer dates
cannot be inferred from a headcount. Stable outcome IDs link each compensation
package and recruiting round. Unknown values remain null. Recorded tier keys
must exist in the target batches; batch policy is never overwritten. Genuine
student submissions displace matching anonymous stand-ins.

Limits are 500 KB compressed, 24 MB expanded, 10,000 outcomes and 20 batches.
Compress before uploading so the normal Server Action request limit is retained.
Source workbooks, archive uploads and private backups stay outside the public
repository. `npm run archive:verify` exercises access checks, transaction
rollback, preserved detail, concurrent retries and genuine submission matching
against a disposable localhost database.

## Backup and restore

The owner-only `/api/admin/backup` endpoint downloads a gzip-compressed,
consistent DB snapshot (`.json.gz`) to fit function response limits.
It includes private student identifiers, placement/configuration tables,
edit history, moderation and audit records. It excludes infrastructure credentials
and ephemeral rate-limit buckets. Store backups encrypted with restricted access,
outside Git. Ordinary placement CSV/JSON exports are **not** full backups.

An operator with DB access can also run:

```bash
npm run backup:create -- /private/placement-private-backup.json
```

To recover, point the environment at a **new, empty PostgreSQL database**, run
`npm run db:deploy` (do not seed), then:

```bash
npm run backup:restore -- /private/placement-private-backup.json.gz --empty-database
```

Restore accepts compressed downloads and older plain JSON backups, checks the
exact migration set and refuses a populated target. All
tables restore in one transaction; failure leaves no partial dataset. Periodically
test restores, verifying counts, owner login, policies and totals before routing
traffic. PostgreSQL/provider backups remain the primary recovery route for large
DBs or recovery before any owner has signed in.

## Portable deployment

Configure ordinary PostgreSQL, PESU-auth, the recovery SRN and session secret in
the gitignored `.env.production.local`. Load that environment into the operator's
release shell before applying migrations. Never use local development DB
passwords in production.

```bash
npm ci
npm run db:deploy
docker compose -f compose.production.yml up -d --build
```

The image runs standalone Next.js as an unprivileged user. Compose binds it to
loopback; put a TLS reverse proxy in front with request limits. Provide backups,
restart monitoring and host maintenance. Runtime credentials are excluded from
the Docker build context. PESU-auth remains separate; use HTTPS across hosts.

## Performance

App functions and DB are co-located. Public analytics use versioned Next.js
cache entries, bounded per-process connection pools, sidebar prefetching and
navigation caching. DB triggers increment batch revisions for offer, package
and component edits. Live pages refresh on revisions and pause polling while
hidden. Batch setting edits also increment the revision. Permissions always
read current database state. Monitor usage before increasing polling frequency;
provider cold starts remain a separate source of latency.
