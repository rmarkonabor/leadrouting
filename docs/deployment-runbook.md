# Deployment Runbook

Exact, step-by-step manual deployment procedure. No step here is
automated by CI or by this session — deployment to a real (preview or
production) environment is always a deliberate, human-executed action, per
CLAUDE.md rules 10-13.

## 0. Before you start

- [ ] All CI checks (`checks`, `migration-validation`, `integration-tests`)
      are green on the PR being deployed.
- [ ] `docs/production-readiness.md` §31's release blockers are resolved
      or explicitly, knowingly accepted.
- [ ] You have the linked Supabase project's connection details (SQL
      Editor access, or a direct Postgres connection string for
      `supabase db push`).
- [ ] You have Vercel project access with permission to view/set
      environment variables and trigger deployments.

## 1. Apply pending database migrations

**Never run this against `--linked` from an automated process — always a
deliberate, manual step (CLAUDE.md rules 10-12).**

1. List pending migrations: compare `supabase/migrations/*.sql` against
   what's already applied to the linked project (Supabase Dashboard →
   Database → Migrations, or `supabase migration list --linked`).
2. Review each pending migration's SQL before applying — confirm it's
   additive, or if destructive, that it was called out and reviewed per
   `docs/database-schema.md` §22.
3. Apply via one of:
   - `supabase db push` (requires `supabase link --project-ref <ref>`
     first), or
   - paste the migration SQL directly into the Supabase SQL Editor and
     run it, in filename (timestamp) order.
4. **As of this audit, the following migrations exist and must be
   confirmed applied, in this order** (skip any already applied):
   - `20260813070000_milestone8_integrations.sql`
   - `20260813080000_milestone9_routing_state_race_fix.sql`
   - `20260813090000_grant_table_privileges_to_data_api_roles.sql`
     (**release blocking** — see `docs/production-readiness.md` §20)
   - `20260813100000_validate_manual_assignment_org_membership.sql`
     (**release blocking** — see `docs/production-readiness.md` §4)
5. Verify: run a read query against a real table as an authenticated
   session (e.g. load the app's dashboard) and confirm no `permission
denied` errors.

## 2. Configure environment variables

Set these in the target Vercel environment (Development / Preview /
Production — set independently, do not assume one set of values works for
all three). See `.env.example` for the full list with descriptions.

**Client-visible** (`NEXT_PUBLIC_*` — safe to expose):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SENTRY_DSN` (optional — Sentry no-ops without it)

**Server-only** (never expose to the browser):

- `SUPABASE_SECRET_KEY`
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (optional — source
  map upload skips with a warning if unset)
- `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`
- `CRM_CLIENT_ID`, `CRM_CLIENT_SECRET`, `CRM_REDIRECT_URI`
- `GEOCODING_PROVIDER_KEY`
- `WEBHOOK_ENCRYPTION_KEY`
- `CRON_SECRET`

For each variable in the Vercel dashboard, explicitly check which
environment(s) (Development/Preview/Production) it applies to — **do not
leave "all environments" checked for anything meant to differ per
environment** (in particular: Supabase project URL/keys, if dev/preview
uses a different Supabase project than production per
`docs/production-readiness.md` §29).

## 3. Configure Supabase-side Cron wiring (required for `CRON_SECRET` to do anything)

The Milestone 6/8 Cron jobs (`process-assignment-notifications`,
`process-crm-sync`, `process-outbound-webhooks`) are registered by
`pg_cron` on the Supabase project itself, not by Vercel Cron. Each job
calls the app's internal queue-processing route over HTTP via `pg_net`,
reading its target URL and auth secret from a single-row config table,
`app_private.cron_http_config`
(`supabase/migrations/20260813110000_cron_http_config_table.sql`).
Setting `CRON_SECRET` in Vercel alone does nothing: the `where exists
(...)` guard on each job means it silently no-ops until this table is
populated on Supabase too.

(An earlier version of this step tried `alter database postgres set
app.settings.app_url = ...` per the original Milestone 6/8 migration
comments. That fails on a real hosted Supabase project with `permission
denied to set parameter` — Supabase reserves `ALTER DATABASE`-level
custom settings for its own management plane — and the dashboard's
"Custom Postgres Config" UI these comments also pointed at no longer
exists. `20260813110000_cron_http_config_table.sql` replaces both
`app.settings.*` lookups with the table below specifically because a
plain table `UPDATE` is not a restricted operation the way `ALTER
DATABASE` is.)

1. Confirm `supabase/migrations/20260813110000_cron_http_config_table.sql`
   is applied to the target project (it's part of step 1's pending-migration
   list like any other).
2. In the Supabase SQL Editor for the target project (dev/preview or
   production — each has its own row), run:
   ```sql
   update app_private.cron_http_config
   set app_url = '<the app's base URL for this environment>',
       cron_secret = '<the exact same value as this environment's CRON_SECRET in Vercel>'
   where id;
   ```
3. The two values must match per environment — production's
   `cron_secret` must equal production's Vercel `CRON_SECRET`, and
   likewise for preview/dev. Do not reuse a preview secret in production
   or vice versa.
4. Confirm `pg_cron` and `pg_net` are enabled on the project (Database >
   Extensions). The scheduling migration only registers the HTTP-calling
   jobs when both are present — see `is_cron_available()` and the
   `pg_extension` check next to each `cron.schedule(...)` call.
5. Verify: after the row is updated, check `cron.job_run_details` (or
   wait for the next minute-cadence run) for a
   `process-assignment-notifications` invocation returning HTTP 200/204
   rather than 401 (secret mismatch) or a connection failure (wrong
   `app_url`).

## 4. Deploy to Preview

1. Push the branch (or open/update a PR) — Vercel's GitHub integration
   creates a Preview deployment automatically. No manual trigger needed.
2. Wait for the deployment to reach `Ready` (check the PR's Vercel status
   comment, or the Vercel dashboard).
3. Open the Preview URL and confirm the app loads.
4. Sign in as a real user and confirm at least one authenticated
   read/write works (e.g. view the dashboard, view a lead).
5. Run the Sentry verification steps in `docs/setup.md` §6.3-6.6 (trigger
   a real browser and server test error, confirm both arrive in Sentry
   with `environment: preview`, readable stack traces, and zero personal
   fields).
6. Run the Playwright critical journeys against this Preview URL:
   ```
   E2E_BASE_URL=<preview-url> E2E_ORG_SLUG=... E2E_ADMIN_EMAIL=... \
     E2E_ADMIN_PASSWORD=... npm run test:e2e
   ```
   (See `tests/e2e/README.md` for the additional env vars each of the six
   Milestone 9 journeys needs, and what each one covers.)

## 5. Deploy to Production

**Never do this without explicit approval from the person responsible for
this decision — CLAUDE.md rule 13. This is not a step to perform as part
of routine development.**

1. Confirm every item in `docs/production-readiness.md` §31 (release
   blockers) is resolved or explicitly accepted.
2. Confirm the migrations in step 1 above are applied to the
   **production** Supabase project specifically (not just a dev/preview
   one, if they're genuinely separate per §29).
3. Merge the approved PR into the production branch (`main`, per the
   Vercel project's own Git integration settings — verified in
   `docs/production-readiness.md` §28/§30 that `target: production`
   deployments only ever originate from `main`).
4. Vercel deploys automatically on that merge. Do not manually promote a
   Preview deployment to Production as a way to bypass this — the point of
   restricting production to `main` is that every production deploy has a
   corresponding merged, reviewed commit.
5. Immediately after deploy: repeat the smoke checks from step 4.4-4.5
   above (authenticated read/write works; a real error reaches Sentry)
   against the production URL specifically.
6. Watch `docs/incident-response.md`'s monitoring guidance for the first
   hour after any production deploy.

## 6. Rollback

If a production deploy causes a regression:

1. In the Vercel dashboard, find the last known-good deployment and use
   "Promote to Production" (or redeploy that specific commit) — this is
   the fastest rollback path and does not require a new merge.
2. If the regression is caused by a bad migration (not just app code),
   see `docs/incident-response.md` — do not attempt to hand-write a
   corrective migration under pressure; follow the documented process.
3. Open an incident per `docs/incident-response.md` regardless of how
   quickly it's resolved, so it's tracked.
