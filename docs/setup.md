# Local setup

Prerequisites: Node.js 20+, npm, Docker (only if you want to run the local
Supabase stack and the RLS integration tests).

## 1. Install dependencies

```
npm install
```

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in real values:

```
cp .env.example .env.local
```

For local development against a real Supabase project you only need these
to run the app (the rest are validated as optional until the milestone
that needs them — see `docs/decisions.md` and `src/lib/env/server.ts`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are safe
to expose to the browser (CLAUDE.md rule 5); `SUPABASE_SECRET_KEY` must
never be referenced outside `src/lib/env/server.ts` and files that import
it — see `docs/security-model.md` §3.

### Option A — local Supabase stack (requires Docker)

```
npx supabase start
```

This applies `supabase/migrations/*.sql` automatically and prints local
URL/keys to use in `.env.local` (`http://127.0.0.1:54321` and a local
publishable/secret key pair). Supabase Studio is available at
`http://127.0.0.1:54323` if you want to inspect data or sign up a test user
manually instead of through `/login`.

### Option B — a real (free-tier) Supabase project

Create a project at supabase.com, then either:

- Run `npx supabase link --project-ref <ref>` and `npx supabase db push`
  to apply `supabase/migrations/*.sql` (review the SQL first — see
  `docs/database-schema.md` §22 and CLAUDE.md rules 9–12), or
- Paste the migration SQL into the Supabase SQL editor manually.

Copy the project's URL and publishable/secret keys from Project Settings →
API into `.env.local`.

## 3. Run the app

```
npm run dev
```

Visit `http://localhost:3000`. Sign up a user (via Supabase Studio's Auth
UI locally, or your Supabase project's dashboard — there is no self-service
sign-up page in Milestone 1, only sign-in, since Phase 1 uses invitation-
based registration going forward), then sign in at `/login`. Once signed
in, the root page lets you create your first organization (the
`bootstrap_organization` bootstrap path — see `docs/decisions.md` ADR-014)
and shows your organization memberships.

## 4. Quality gates

Run all of these before considering any change complete (CLAUDE.md rule 15):

```
npm run format        # prettier --check .
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run build           # next build
```

## 5. Running the RLS / tenant-isolation integration tests

These require a real Postgres instance with the Milestone 1 migration
applied (they're skipped otherwise — see
`tests/integration/README.md` for full detail):

```
npx supabase start
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

## 6. Sentry (error monitoring)

Implemented in Milestone 2 — see `docs/decisions.md` ADR-013 and
ADR-024–ADR-026, and `docs/security-model.md` §7 for the sanitizer policy.
The app runs fine with no Sentry configured at all (`Sentry.init` no-ops
without a DSN); these steps are only needed to actually see events in a
Sentry project.

### 6.1 Get Sentry credentials

1. Create a project at sentry.io (or use an existing one) — platform
   "Next.js."
2. Copy its DSN from **Settings → Client Keys (DSN)** → `NEXT_PUBLIC_SENTRY_DSN`.
3. Note the org and project slugs from the project's Settings URL →
   `SENTRY_ORG` / `SENTRY_PROJECT`.
4. Create an auth token at **Settings → Auth Tokens** with `project:releases`
   and `org:read` scopes → `SENTRY_AUTH_TOKEN`. This is build-time-only
   (source map upload) — never commit it, never reference it with a
   `NEXT_PUBLIC_` prefix.

### 6.2 Add the variables to Vercel

In the Vercel project's **Settings → Environment Variables**, add all four
vars — `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT` — and for each one, check the environment(s) it applies
to:

1. **Development** (used by `vercel dev` / pulled via `vercel env pull`,
   not plain local `next dev` — that reads `.env.local` instead): check
   the **Development** box for each variable, using the same Sentry
   project (or a separate one if you want local noise fully isolated from
   Preview/Production — either is fine, since `environment` on every event
   is already tagged by `VERCEL_ENV`/fallback, not by which Sentry project
   it landed in).
2. **Preview**: check the **Preview** box for each variable. This is what
   the verification steps below exercise.
3. **Production**: check the **Production** box for each variable only
   when you're ready to actually monitor production — do this deliberately,
   not as a side effect of setting up Preview (CLAUDE.md rule 13: no
   production deploys without explicit approval, and populating Production
   env vars is part of that decision).

Concretely, in the Vercel dashboard's "Add Environment Variable" form this
means: enter the name and value once, then tick the checkbox(es) for which
environment(s) it should apply to before saving — repeat for all four
variables, ticking a different combination of boxes per environment as
described above if you want different Sentry projects per environment, or
the same combination for all four if using one project everywhere.

### 6.3 Deploy the branch as a Preview

Push the branch (or open a PR) — Vercel's GitHub integration creates a
Preview deployment automatically. Wait for it to finish building.

### 6.4 Trigger the browser test error

1. Open `https://<preview-url>/sentry-example-page`.
2. Click **"Throw browser test error"**.
3. In Sentry, open the project's Issues list — an issue titled `Error:
Sentry browser test error (sentry-example-page button)` should appear
   within a few seconds, tagged `environment: preview`.

### 6.5 Trigger the server test error

1. On the same page, click **"Throw server test error"** (or visit
   `https://<preview-url>/api/sentry-example-api` directly — it responds
   `500`, which is expected, the point is the thrown error, not the HTTP
   status).
2. In Sentry, a second issue titled `Error: Sentry server test error
(sentry-example-api route handler)` should appear, also tagged
   `environment: preview`, with a `nextjs` context showing
   `route_type: "route"` / the request path.

### 6.6 Verify readable TypeScript source maps

Open either issue in Sentry and check the stack trace:

1. It should show the original `.tsx`/`.ts` file paths (e.g.
   `src/app/sentry-example-page/sentry-test-buttons.tsx` or
   `src/app/api/sentry-example-api/route.ts`), not a minified/bundled
   filename like `_next/static/chunks/1234.js`.
2. Source context lines (a few lines before/after the throw) should show
   real TypeScript, including our comments and variable names — not
   minified/mangled identifiers.
3. If it instead shows a minified bundle path with no source context, the
   most likely cause is `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`
   not being set on the Preview environment (source map upload is skipped
   silently, with only a build-log warning, when they're absent) — check
   the Vercel build log for `[@sentry/nextjs]` lines confirming an upload
   ran.

### 6.7 Before a real production deploy

The test routes (`/sentry-example-page`,
`/api/sentry-example-api`) are already protected — they 404 automatically
once `VERCEL_ENV=production` (see `src/lib/sentry/test-routes.ts` and
`docs/decisions.md` ADR-020), so no manual removal step is required. If
you'd rather remove them outright instead of relying on the runtime gate,
delete `src/app/sentry-example-page/` and
`src/app/api/sentry-example-api/`.

## 7. Things this setup deliberately does not do yet

- No service-role Supabase client exists yet — it's introduced in the
  milestone that first needs it (queue/cron consumers), per
  `docs/security-model.md` §3.
- No user invitation, team, or lead functionality — that's Milestones 2+
  per `docs/implementation-plan.md`. The only way to create an organization
  right now is the `bootstrap_organization` flow described above.
- Sentry Session Replay is intentionally disabled for Phase 1 (spec §47).
