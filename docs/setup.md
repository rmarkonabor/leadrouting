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

## 6. Things this setup deliberately does not do yet

- No Sentry SDK wiring (`docs/decisions.md` ADR-013) — structured logging
  (`src/lib/logging`) and `AppError` cover Milestone 1's safety
  requirements in the meantime.
- No service-role Supabase client exists yet — it's introduced in the
  milestone that first needs it (queue/cron consumers), per
  `docs/security-model.md` §3.
- No user invitation, team, or lead functionality — that's Milestones 2+
  per `docs/implementation-plan.md`. The only way to create an organization
  right now is the `bootstrap_organization` flow described above.
