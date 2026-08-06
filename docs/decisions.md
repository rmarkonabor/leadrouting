# Architecture Decisions

Running log of decisions made during planning and implementation. Newest
entries at the bottom. Each entry: context, decision, status.

## ADR-001: Hyphenated doc filenames over the spec's underscore examples

**Context**: `docs/phase1-product-spec.md` §49 and §59 show example
filenames using underscores (`database_schema.md`, `phase1_product_spec.md`,
etc.), but the direct task instructions for this planning pass named 13
files with hyphens (`docs/database-schema.md`,
`docs/specification-coverage.md`, `docs/background-processing.md`, and
others §49 doesn't list at all, like `api-specification.md`).
**Decision**: use the hyphenated names from the direct task instructions.
They are the more specific, more recently given instruction and enumerate
a complete, unambiguous 13-file set; the spec's own filename casing is
illustrative example text, not a scope requirement.
**Status**: adopted.

## ADR-002: Include the PostGIS extension despite it being absent from the initial 17-item approved stack list

**Context**: The task's opening message enumerated 17 approved
technologies without mentioning PostGIS. `docs/phase1-product-spec.md` §4
explicitly adds "Supabase PostGIS extension" to the approved stack, and §23
(radius territories) and §27.5 (`within_radius` operator) require
geographic distance queries that only PostGIS practically provides inside
Postgres.
**Decision**: include PostGIS. It is a Postgres extension shipped and
enabled through Supabase, not a separate database product or provider, so
it does not violate the "no other database provider" exclusion. The spec
is the source of truth for functionality, and radius-based territory
matching is explicitly in scope (spec §5 item 23, §56 item 22).
**Status**: adopted. Enabled starting in the Milestone 4 migration that
introduces `territories`.

## ADR-003: CRM credential and webhook secret encryption via Supabase Vault

**Context**: spec §52 requires "encrypted CRM credentials" but does not
name a mechanism, and the excluded-technology list rules out introducing a
new secrets-management provider.
**Decision**: use Supabase Vault (`pgsodium`-backed, built into Supabase
Postgres) to store CRM OAuth credentials and webhook signing secrets at
rest, rather than hand-rolled application-level encryption with a manually
managed key. This avoids adding a new provider and avoids the higher risk
of a bespoke crypto implementation.
**Status**: proposed — confirm Vault is available on the target Supabase
plan before Milestone 8; if not, fall back to `pgcrypto` with
`WEBHOOK_ENCRYPTION_KEY`/an equivalent app-managed key stored only in
Vercel environment variables, never in the database.

## ADR-004: Rate limiting is database-backed, not Redis-backed

**Context**: spec §18 and §52 require request rate limiting on the intake
endpoint; Redis is explicitly excluded from the stack.
**Decision**: implement rate limiting with a Postgres counter table keyed
by `(lead_source_id, time_bucket)`, incremented via an atomic upsert, or
via Vercel Edge Middleware's built-in limiting if it meets the
per-source configurability requirement. Final choice made in Milestone 3
based on measured latency impact; recorded here once decided.
**Status**: open — default assumption is the Postgres counter table
approach unless Milestone 3 implementation finds it insufficient.

## ADR-005: Intake "test mode" semantics

**Context**: spec §18 requires a "test mode" for the intake endpoint but
doesn't define exactly what persists.
**Decision**: test mode (`X-Test-Mode: true`) runs the full mapping/
validation/routing-preview pipeline (sharing code with the simulator) but
persists only a `submission_logs` row with `test_mode = true` — no `leads`,
`assignments`, `activities`, queue messages, or CRM/webhook side effects.
This mirrors the simulator's "must not create a live lead/assignment"
guarantee (spec §34) and gives source integrators a safe way to verify
field mapping end-to-end.
**Status**: adopted, to be confirmed with early design-partner feedback
during Milestone 3.

## ADR-006: RLS policies re-check live membership, not a JWT custom claim

**Context**: spec §9 requires that the application never trust a
browser-supplied `organization_id` and always verify membership
server-side. A common Supabase pattern stores `organization_id`/role in a
JWT custom claim for performance.
**Decision**: RLS policies query `organization_users` directly
(`exists (...) where user_id = auth.uid() and status = 'active'`) rather
than reading a claim, so a revoked/deactivated membership takes effect
immediately rather than only after token refresh. Accept the small
per-query join cost as the price of closing that window.
**Status**: adopted. Revisit only if this measurably impacts P95 query
latency at pilot scale, and if so, prefer shortening JWT/session TTL
before reintroducing claim-based trust.

## ADR-007: Team manager scope defined by team membership, not a separate grant table

**Context**: spec §8.2 says a team manager acts within "permitted teams"
but doesn't define how a team becomes "permitted" for a given manager.
**Decision**: `team_users` gets an `is_manager boolean not null default
false` column; a `team_manager`-role user's permitted teams are exactly the
teams where they have a `team_users` row with `is_manager = true`. This
avoids a redundant grants table and keeps team membership and management
authority in one place. A consequence accepted deliberately: a
`team_manager` must be a member of a team to manage it — Phase 1 has no
"manage without belonging" case in the spec, so this is not a gap.
**Status**: adopted (finalized during the architecture/coverage audit).
`docs/permissions-matrix.md`, `docs/database-schema.md`, and
`docs/security-model.md` all reference this column consistently.

## ADR-008: Round-robin/weighted-round-robin concurrency safety via row locking, not advisory locks or a separate scheduler

**Context**: spec §29.2–§29.3 and §54 require atomic rotation state under
concurrent routing requests.
**Decision**: `route_lead` takes `SELECT ... FOR UPDATE` on the relevant
`routing_state` row before reading/advancing the cursor, inside the same
transaction that creates the assignment. No advisory locks, no external
scheduler/queue-based serialization — plain row-level locking inside the
existing transaction.
**Status**: adopted.

## ADR-009: Webhook idempotency relies on a stored `event_id`, not provider-side deduplication

**Context**: spec §43 requires idempotent delivery and replay protection.
**Decision**: every outbound webhook event gets a UUID `event_id`
generated at creation time and stored in `webhook_deliveries` under a
unique `(webhook_endpoint_id, event_id)` constraint; retries reuse the
same `event_id` rather than minting a new one. Receiver-side dedupe on
`event_id` is documented as the customer's responsibility.
**Status**: adopted.

## ADR-010: Auth via `@supabase/ssr` with `getUser()` as the only authorization-grade identity check

**Context**: the architecture/coverage audit found that no document
specified which Supabase client-integration pattern to use, and Supabase's
own guidance warns that `supabase.auth.getSession()` decodes a JWT from
the cookie without contacting the Auth server, so it can be satisfied by a
stale or tampered cookie — unsafe as the basis for a server-side
authorization decision.
**Decision**: use `@supabase/ssr` (not the deprecated
`@supabase/auth-helpers-nextjs`) for browser/server/middleware client
creation, and require every authorization-relevant identity check to go
through `supabase.auth.getUser()` (verified against the Auth server) via a
single shared `getVerifiedUser()` helper. `getSession()` is permitted only
for non-authoritative client-side UI state, never for a permission
decision.
**Status**: adopted.

## ADR-011: Public intake endpoint resolves its source via a scoped `SECURITY DEFINER` function, not the Supabase service-role client

**Context**: the audit found that `docs/security-model.md` originally
restricted service-role key usage to "Queue/Cron consumers and Edge
Functions" without addressing how the public, pre-session
`POST /api/v1/intake/[sourceToken]` endpoint resolves `lead_sources` by
token — the only plausible reading was that it also needed the
service-role client, which would put the most exposed, highest-risk
endpoint in the codebase on the same privilege level as trusted background
jobs.
**Decision**: add `resolve_lead_source(token text) returns table
(lead_source_id uuid, organization_id uuid, status text)` as a `SECURITY
DEFINER` Postgres function, callable via RPC by the `anon`/publishable-key
client. It performs exactly one narrow lookup (hash the token, match
`source_token_hash`, return three columns) and nothing else. The intake
route handler never imports the service-role client.
**Status**: adopted.

## ADR-012: Migration reversibility policy

**Context**: the audit required migrations to be "reversible where
practical," which the original `docs/database-schema.md` /
`docs/architecture.md` text didn't address beyond "forward-only."
**Decision**: default to additive migrations (trivially undone by a
follow-up migration in local/preview environments); isolate any
destructive migration (drop/type-change/tightened constraint) into its own
file with mandatory extra reviewer sign-off; treat `supabase db reset`
(local only, never `--linked`) as the practical rollback mechanism
pre-production; roll back a bad linked migration with a new forward
migration, never a manual edit or a linked destructive command without
explicit user approval. Full detail in `docs/database-schema.md` §22.
**Status**: adopted.

## ADR-013: Sentry SDK wiring deferred out of Milestone 1

**Context**: `docs/architecture.md` / `docs/implementation-plan.md`
originally scoped a Sentry foundation (shared sanitizer + client/server/edge
config) into Milestone 1. The actual Milestone 1 kickoff instructions given
for implementation listed 27 explicit requirements and did not include
Sentry SDK wiring among them, and no real Sentry DSN/org/project exists yet
(`.env.example` values are placeholders). `@sentry/nextjs` also has not yet
published confirmed compatibility with this project's Next.js 16.3.0
(Turbopack) at time of implementation.
**Decision**: implement the Milestone 1 pieces that don't depend on the
Sentry SDK — structured logging (`lib/logging`) and the consistent
`AppError` format — and defer `@sentry/nextjs` installation/configuration
to the milestone that first needs error monitoring in a real environment,
rather than wiring an SDK against a placeholder DSN and an unverified
Next.js version pairing. `lib/logging`'s allow-list is written so a future
Sentry `beforeSend` sanitizer can reuse the same allowed-key list.
**Status**: adopted for Milestone 1. Revisit at the start of the next
milestone that touches production error monitoring — flagged as a known
limitation, not a scope cut.

## ADR-014: Organization creation via a single `bootstrap_organization()` SECURITY DEFINER function, no direct client insert path

**Context**: Milestone 1 needed some way to create the first organization
and its owning membership for manual/testing purposes, without building
the full organization-settings admin module (out of scope until later
milestones) and without granting a raw client-side INSERT policy on
`organizations`/`organization_users` (which would make "one organization,
one owning admin, created atomically" much harder to guarantee).
**Decision**: `bootstrap_organization(org_name, org_slug)` is a `SECURITY
DEFINER` Postgres function that creates the organization row and its
caller's `org_admin` membership row in one transaction, callable only by
`authenticated` (not `anon`). No INSERT policy exists on either table for
`authenticated`, so this function is the only path that can create an
organization — a direct client insert attempt fails RLS. `auth.uid()`
still reflects the real caller even under SECURITY DEFINER, so the
function cannot be used to create a membership for someone else.
**Status**: adopted for Milestone 1. Superseded once a full "create
organization" admin flow with invitation-based team-building exists.

## ADR-015: Environment validation forced eagerly via `instrumentation.ts`

**Context**: `lib/env/public.ts` and `lib/env/server.ts` validate
`process.env` via Zod at module-evaluation time, but Zod validation only
actually runs when something imports those modules. Nothing in the
Milestone 1 codebase needed `serverEnv` yet (no service-role client exists
until a later milestone — see ADR-011), so `SUPABASE_SECRET_KEY` validation
was silently never exercised, undermining spec §53's "All environment
variables must be validated during application startup."
**Decision**: add `src/instrumentation.ts` with a `register()` function
(Next.js's official startup hook, stable since Next 15) that imports both
env modules under `NEXT_RUNTIME === "nodejs"`, forcing validation to run
once when the server process starts rather than lazily on first use.
**Status**: adopted.

## ADR-016: Security-advisor fixes applied as a follow-up migration after linking the development project

**Context**: applying `20260805160000_foundation_organizations_and_membership.sql`
to the connected development Supabase project (ref `qejvrdfrcdatdjxwlane`)
and running `get_advisors` surfaced three real findings the local review
missed: (1) `set_updated_at()` had no pinned `search_path`
(`function_search_path_mutable`); (2) Supabase's default-privilege template
grants `EXECUTE` on newly created functions directly to `anon` and
`authenticated` at `CREATE FUNCTION` time — the original migration's
`revoke all on function bootstrap_organization(...) from public` only
revoked the `PUBLIC` pseudo-role's grant, not those separate direct grants,
so `bootstrap_organization()` remained callable by the unauthenticated
`anon` role via PostgREST RPC even though the function's own `auth.uid()
is null` check would still reject it; (3) the trigger-only functions
`set_updated_at()` and `handle_new_auth_user()` were reachable as public
RPC endpoints for no reason, since no client should ever call them
directly.
**Decision**: rather than editing the already-applied migration (forbidden
by `docs/database-schema.md` §22 / CLAUDE.md rule 9), added
`20260805170000_foundation_security_advisor_fixes.sql`: pins
`set_updated_at()`'s `search_path`, revokes all `anon`/`authenticated`
grants on both trigger-only functions (trigger firing does not require the
firing session to hold `EXECUTE` on the trigger function, so this doesn't
break `on_auth_user_created`/the `updated_at` triggers), and revokes
`anon`'s grant on `bootstrap_organization()` while keeping `authenticated`.
Verified via `information_schema.routine_privileges` and a re-run of
`get_advisors` that only two expected/intentional findings remain:
`bootstrap_organization` still shows as `authenticated`-executable (by
design — that's how legitimate callers reach it) and `rls_auto_enable()`
is a pre-existing Supabase-platform-managed function this project didn't
create, out of scope to modify.
**Status**: adopted. Takeaway for future milestones: always run
`get_advisors` after applying a migration to a real project, not just
after a local/offline review — default-privilege grants made at function
creation time are easy to miss by reading the SQL alone.

## ADR-017: Minimal CI workflow added early, ahead of Milestone 9

**Context**: `docs/implementation-plan.md` scopes GitHub Actions CI into
Milestone 9 ("Production Readiness"). PR #1 (Milestone 1) had no automated
gate at all — no workflow file, no Vercel integration — so "merge only
after tests pass" had nothing to check against, and the only verification
was Claude's self-reported local test run.
**Decision**: add a small `.github/workflows/ci.yml` now (checkout, Node
22, `npm ci`, then `npm run format`/`lint`/`typecheck`/`test`/`build`,
using non-sensitive placeholder env values so Zod env validation succeeds
without a real Supabase project) so this and future PRs have a real,
independently-verifiable gate. This is deliberately the minimal subset —
Playwright, a spun-up local Supabase stack for the RLS integration suite,
and a dependency vulnerability scan remain Milestone 9 scope per
`docs/testing-strategy.md` §4, not pulled forward here.
**Status**: adopted. Verified by running the exact CI steps locally with
the same placeholder env vars before pushing — this caught a real bug in
`tests/unit/env.test.ts` (see below).

**Bug caught in the process**: `env.test.ts`'s
`"loads successfully when SUPABASE_SECRET_KEY is present"` test hardcoded
an expectation of `"test-secret-key"`, which is only true because
`tests/setup.ts` sets that value via `??=` (only applies if unset). In an
environment that already provides a real `SUPABASE_SECRET_KEY` (CI, or any
future real environment), the `??=` never fires and the hardcoded
expectation fails. Fixed to assert against whatever
`process.env.SUPABASE_SECRET_KEY` actually is at test time instead of a
hardcoded literal.

## ADR-018: Note on ADR numbering across parallel branches

**Context**: `milestone/02-sentry` (Sentry error monitoring, PR #2) and
`milestone/02-users-teams-roles` (Users/Teams/Roles, PR #3) were developed
in parallel from the same `main` commit, and both independently claimed
ADR-018 onward. PR #3 merged first.
**Decision**: keep PR #3's ADR-018–ADR-023 numbers as merged (they're
already referenced from `docs/implementation-plan.md`'s Milestone 2 status
note); renumber this branch's three Sentry ADRs to ADR-024–ADR-026 when
merging, rather than the reverse.
**Status**: adopted — this is the "trivial renumber-on-merge" resolution
anticipated by this same ADR when it was first written on the other branch.

## ADR-019: Invitation flow uses the Supabase Auth Admin API, attaching an already-registered email instead of re-inviting

**Context**: spec §10 requires "invitation based registration." Milestone 1
gave `organization_users.user_id` a `not null` foreign key to `auth.users`,
so a person cannot be invited before their `auth.users` row exists — but
creating that row (and sending the invite email) requires the Supabase Auth
Admin API, which only the service-role key can call; the publishable-key
client cannot create auth users at all. A second wrinkle: someone already
registered (e.g. already a member of a different organization) must be
attachable to a new organization without receiving a duplicate "create your
password" email.
**Decision**: `modules/users/invite-user.ts` calls
`serviceRole.auth.admin.inviteUserByEmail()`. If that fails because the
email is already registered (`error.code === "email_exists"` or an
"already registered" message — the Admin API does not return a special
"success but existing" response, only an error we have to interpret), a
narrow `SECURITY DEFINER` SQL function, `find_auth_user_id_by_email`,
resolves the existing `auth.users.id` (which is otherwise unreachable via
PostgREST) so the module can attach that person's existing account to the
new organization via a normal `organization_users` insert (`status =
'invited'`), with no duplicate email sent. This is the first module allowed
to import the service-role client — see ADR-020.
**Status**: adopted. Known limitation: the "already registered" detection
depends on matching the Admin API's current error shape/message, which is
not contractually guaranteed by the SDK across versions — flagged here so a
future SDK upgrade that changes this error shape is easy to trace back to
this decision if the "attach existing user" path silently stops working.

## ADR-020: Service-role Supabase client introduced, confined by an ESLint import-boundary rule

**Context**: Milestone 1's `docs/security-model.md` §3 anticipated this
moment: "an ESLint import-boundary rule enforces this at build time," but
no such rule existed yet in Milestone 1 because no service-role client
existed yet to restrict. ADR-019's invitation flow is the first real
consumer.
**Decision**: added `src/lib/supabase/service-role.ts` (the client itself)
and an `eslint.config.mjs` `no-restricted-imports` rule that blocks
importing it from anywhere by default, with a per-directory override
re-enabling it only for `src/modules/users/**` and `src/modules/imports/**`
(the bulk-import module also needs to invite users). The public lead-intake
route (a later milestone) is deliberately never on this allow-list. Every
caller of the service-role client is still gated by an explicit
`requireOrgAdminContext` check performed _before_ the client is touched, so
RLS bypass is not the only line of defense (docs/security-model.md §1).
**Status**: adopted.

## ADR-021: RLS helper functions run `SECURITY DEFINER` to avoid self-referencing policy recursion

**Context**: Milestone 2's role-scoped RLS policies need a "does this user
manage this team?" check (`is_permitted_team_manager`) used inside
`team_users`' own SELECT/INSERT/UPDATE/DELETE policies — a table checking a
condition about itself, inside its own policy. A naive `SECURITY INVOKER`
helper function would itself be subject to `team_users`' RLS when it runs
its internal query, which is the same policy currently being evaluated —
a well-known Postgres/Supabase RLS recursion hazard.
**Decision**: `is_active_org_member`, `is_org_admin`, and
`is_permitted_team_manager` are all `SECURITY DEFINER` with `search_path`
pinned to `public`, following the same audited-narrow-function pattern as
Milestone 1's `bootstrap_organization`. Each takes only `auth.uid()` (never
attacker-controlled identity) as its implicit input, so running as definer
does not introduce a privilege-escalation path — it only lets the function
see all rows of the table it checks, then apply the same
`auth.uid()`-scoped filter that RLS would have applied anyway. This is the
standard, documented Supabase pattern for this exact problem.
**Status**: adopted.

## ADR-022: CSV bulk user import: all-or-nothing is a submission decision, not a cross-system transaction

**Context**: spec §14: "Invalid imports must not partially create records
unless the administrator explicitly chooses partial processing." Creating a
user requires both a Supabase Auth Admin API call (not part of any SQL
transaction) and one or more Postgres writes (`organization_users`,
optionally `team_users`) — there is no single transaction that can span
both an external HTTP-based Auth API and Postgres, so true atomicity across
"auth account created" + "org membership created" for an entire batch is
not achievable the way a pure-SQL function (e.g. Milestone 1's
`bootstrap_organization`) guarantees it for a single row.
**Decision**: implement the specific guarantee spec §14 and this
milestone's tests actually require: when `allow_partial` is false and any
row fails validation, `confirmImport` refuses to create _any_ records at
all — it never begins the creation loop. This is a pre-flight decision, not
a rollback, and is fully deterministic and testable without a database
(`tests/unit/imports/confirm-import.test.ts`). When `allow_partial` is
true, valid rows are created one at a time and a mid-batch external API
failure on one row does not roll back rows already created for that batch —
this is a known, documented limitation of mixing an external Auth API with
database writes, not a gap in the "abort on invalid, unless partial is
explicitly chosen" guarantee itself.
**Status**: adopted; revisit if a future milestone needs stronger
per-row-failure guarantees during partial-mode imports (e.g. a
saga/compensation pattern), which is out of scope for Phase 1.

## ADR-023: Invitation acceptance needs its own narrow RLS policy + trigger, not the existing org_admin-only UPDATE policy

**Context**: Milestone 1's only UPDATE policy on `organization_users`
requires the caller to be an `org_admin` — correct for role/status changes
made by an administrator, but it means an _invited_ (not yet active) user
has no way to accept their own invitation (flip their own row from
`invited` to `active`), since they aren't an admin and RLS would silently
exclude their own row from the UPDATE.
**Decision**: added a second, permissive UPDATE policy,
`organization_users_accept_own_invitation`, that lets a caller touch only
their own row and only when its current status is `invited`. A
`BEFORE UPDATE` trigger, `enforce_self_accept_invitation_only`, then
constrains what a _non-admin_ caller's update through that door may
actually change: the transition must be exactly `invited -> active`, and
`role`/`invited_by_user_id` must be unchanged — closing the gap a bare RLS
`WITH CHECK` can't close on its own (RLS can't compare a column's old vs.
new value directly; a trigger can). An `org_admin`'s own updates are
unaffected (the trigger no-ops for them, since they're already fully
authorized by the existing `organization_users_update_org_admin` policy).
**Status**: adopted.

## ADR-024: Sentry hand-authored following current `@sentry/nextjs` conventions — wizard could not run non-interactively

**Context**: Milestone 2's kickoff instructed running (or preparing to run)
`npx @sentry/wizard@latest -i nextjs`. The wizard was attempted with
`--non-interactive --skip-connect --disable-telemetry --ignore-git-changes
--saas` (the flags it documents for "agentic setup"), but it still calls
`askHasSentryAccount()` internally and crashed with `ERR_TTY_INIT_FAILED`
in this non-interactive sandbox before writing any files — confirmed via
`git status` showing zero file changes from the attempt. No Sentry account,
org, or project is available in this environment either, so there was no
DSN/org/project to connect to regardless.
**Decision**: hand-author the exact file layout the wizard would produce
for the _current_ `@sentry/nextjs` major version (10.x) on Next.js 16 with
Turbopack, verified against the installed package's own type definitions
and deprecation warnings rather than guessing from older docs:

- `src/instrumentation-client.ts` (not the older `sentry.client.config.ts`
  convention — that file is only auto-detected by Sentry's webpack config
  path, which doesn't run under Turbopack) for the browser init, exporting
  `onRouterTransitionStart` as the SDK requires.
- `src/instrumentation.ts` (Next's own official instrumentation hook, which
  already existed for env validation — see ADR-015) extended with
  `Sentry.init(...)` per runtime (`NEXT_RUNTIME === "nodejs" | "edge"`) and
  `export const onRequestError = Sentry.captureRequestError;`. This one
  hook is what satisfies "Server error monitoring," "Route Handler error
  monitoring," and "Server Action error monitoring" — Next.js calls it for
  all three surfaces, so no per-route manual wrapping is needed.
- `src/app/global-error.tsx` for React global error capture, per the
  Next.js App Router convention (must render its own `<html>`/`<body>`).
- `next.config.ts` wrapped with `withSentryConfig`, using
  `org`/`project`/`authToken` from `process.env` directly (server/build-
  only, never `NEXT_PUBLIC_*`) and `widenClientFileUpload: true`. Confirmed
  via the installed package's type definitions that Turbopack source map
  upload is a first-class, supported path (`after-production-compile-
turbopack`), not a webpack-only feature — `disableLogger` and
  `automaticVercelMonitors` were deliberately left out after the build
  logged them as "not supported with Turbopack" deprecation warnings.
  **Status**: adopted. If a real Sentry account becomes available later, the
  wizard can still be run against this codebase — `--ignore-git-changes`
  would let it detect and skip files that already match its own conventions,
  or a developer can just fill in `.env.local`/Vercel env vars against what's
  already here without re-running it at all.

## ADR-025: `beforeSend` drops ZodError and `AppError("invalid_input")` events instead of reporting them

**Context**: spec §47: "Expected validation errors must not be reported as
Sentry exceptions." The codebase has two shapes of validation failure: a
raw `ZodError` (from a `.parse()` call) and an `AppError` with code
`invalid_input` (the module-boundary wrapper used everywhere else, per
`docs/api-specification.md` §4).
**Decision**: `sentryBeforeSend` inspects `hint.originalException` and
returns `null` (dropping the event entirely, not just downgrading its
level) for both shapes. Every other `AppError` code (including
`internal_error`) and any other exception type is still reported — only
the two known "this is normal user input, not a bug" shapes are
suppressed.
**Status**: adopted.

## ADR-026: Sentry test routes gated on "not a real Vercel Production deployment," not on Node's `NODE_ENV`

**Context**: spec §47 asks for "Development only test routes," but the
Milestone 2 verification steps explicitly require triggering both test
errors on a deployed Vercel **Preview** build — and Vercel Preview builds
run with `NODE_ENV=production` internally, same as a real Production
build. A literal `NODE_ENV !== "production"` gate would 404 the test
routes on the exact environment they're meant to be exercised on.
**Decision**: `areSentryTestRoutesEnabled()` (`src/lib/sentry/test-
routes.ts`) instead checks Vercel's `VERCEL_ENV`, which distinguishes
`preview` from `production` even though both build with
`NODE_ENV=production`: enabled unless `VERCEL_ENV === "production"`, or
unless it's a `NODE_ENV=production` build with no `VERCEL_ENV` at all
(e.g. a local `next build && next start`, treated as production-like and
blocked as the safe default). Confirmed locally that `next build` (NODE_ENV
production, no VERCEL_ENV) 404s both routes, while `next dev` serves them
normally. Satisfies the literal "remove or protect the test routes before
production" instruction via the "protect" option — no manual removal step
is needed before a real Production deploy.
**Status**: adopted.
