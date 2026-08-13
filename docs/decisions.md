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
**Status**: superseded by ADR-051 (Milestone 8) — application-level
AES-256-GCM via `lib/crypto/secret-box.ts`, keyed by
`WEBHOOK_ENCRYPTION_KEY`, not Supabase Vault and not `pgcrypto`.

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

## ADR-027: Milestone 4 (Territories) deferred until Milestone 3 (Lead Intake) is complete

**Context**: a kickoff mid-session asked to implement "only the
territories and internal location processing milestone" directly, before
Milestone 3. `docs/implementation-plan.md` sequences Milestone 3 (Lead
Intake) before Milestone 4 (Territories), and CLAUDE.md rule 2 requires
milestones to be completed in that order. Milestone 4's own scope also
depends on Milestone 3's output: `lead_locations_internal` attaches to the
`leads` table, and its "original submitted location preservation" /
"internal geographic metadata separated from default lead data"
requirements are meaningless before `leads` exists.
**Decision**: flagged the conflict per CLAUDE.md rule 1 rather than
building Territories out of order; the user chose to implement Milestone 3
first. This migration (`20260806120000_milestone3_lead_intake.sql`)
implements Lead Intake; Territories resumes as Milestone 4 afterward.
**Status**: adopted.

## ADR-028: Source tokens are hashed in TypeScript, not inside the `resolve_lead_source` Postgres function

**Context**: ADR-011 established that the intake route resolves its
`lead_sources` row via a `SECURITY DEFINER` function rather than the
service-role client, described as hashing the incoming token internally.
**Decision**: hash the plaintext token with Node's `crypto` (sha256 hex)
in `modules/lead-sources/hashSourceToken`, both at token issuance
(`createLeadSource`/`rotateLeadSourceToken`) and at intake time
(`processLeadSubmission`), and pass only the resulting hash into
`resolve_lead_source(p_token_hash)`/`record_lead_submission`. This keeps a
single hashing implementation instead of two (Node at issuance, `pgcrypto`
at lookup) that would need to stay byte-for-byte identical, while keeping
the plaintext token itself out of any SQL function body or query log.
`pgcrypto` is still enabled (`extensions.digest`) for future use, but
nothing in this migration currently calls it directly.
**Status**: adopted.

## ADR-029: `record_lead_submission` is one transactional SECURITY DEFINER function, not multiple RPC round-trips

**Context**: the public intake route has no session, so every write it
performs (`submission_logs`, `leads`, `lead_custom_values`,
`lead_duplicates`) must go through a function callable by the `anon` role,
bypassing RLS. Field mapping, validation, and duplicate-detection _logic_
live in TypeScript (`modules/field-mapping`, `modules/duplicate-detection`)
for unit-testability, but the actual multi-table write needs to be atomic:
a lead must never exist without its submission log, and a partially-applied
duplicate/custom-value write is worse than either succeeding or failing
outright.
**Decision**: one `plpgsql` `SECURITY DEFINER` function takes the
already-decided mapping/validation/duplicate outputs as parameters and
performs the entire write — including its own idempotency-key re-check —
in a single transaction, mirroring the pattern CLAUDE.md rule 21 requires
for `route_lead` and friends even though intake recording isn't literally
one of the five named operations. The function independently re-validates
`lead_source_id`/status rather than trusting its caller, since it is
reachable by an unauthenticated request.
**Status**: adopted.

## ADR-030: Duplicate-detection window and default action configured via `organizations.settings`, not a new column

**Context**: spec §21 requires a configurable duplicate window and one of
four configurable actions, but neither `docs/database-schema.md` nor the
spec names where this configuration lives — no column exists on
`lead_sources` or a dedicated table for it.
**Decision**: read `organizations.settings.duplicateDetection = {
windowHours, action }` (the existing Milestone 1 `settings jsonb` column),
falling back to `{ windowHours: 24, action: "flag_and_continue" }` when
unset, rather than adding a new migration column ahead of an explicit
product decision on where per-source vs. per-org overrides should live.
**Status**: adopted — revisit if a later milestone needs per-source
overrides.

## ADR-031: `leads.lead_status`/`assignment_status` are plain, loosely-constrained columns in this milestone

**Context**: spec §37 describes org-configurable `lead_status_definitions`
(Milestone 7), and routing/assignment states don't exist until Milestone
5/6. Milestone 3 needs the `leads` table now but has nothing yet to
foreign-key `lead_status` against, and no live assignment states to
enumerate for `assignment_status`.
**Decision**: `lead_status` is free text defaulting to `'new'` (no FK, no
enum); `assignment_status` is text constrained by a `check` to the single
value `'unassigned'` for now. Both are intentionally loose placeholders —
Milestone 7 will add the `lead_status_definitions` relationship, and
Milestone 5/6 will widen the `assignment_status` check constraint (or
convert it to an enum) as real states are introduced, in their own
migrations.
**Status**: adopted.

## ADR-032: Radius territories gated by a live `is_postgis_available()` check, not an assumption

**Context**: spec §23 requirement 7 explicitly asks for radius territories
"only when PostGIS is correctly available" — a live capability guarantee,
not a design-time assumption that Supabase always ships PostGIS (which it
does, in practice, but the requirement's own wording asks for a runtime
check regardless).
**Decision**: `public.is_postgis_available()` (SQL, `stable`, checks
`pg_extension`) is called by every code path that would create or match a
radius territory — `createTerritory`, the territory-import validator, and
(implicitly) any future routing/matching code — before allowing
`territory_type = 'radius'`. The migration's own `create extension if not
exists postgis` is wrapped in a `do $$ ... exception when others $$` block
so a genuinely PostGIS-less environment doesn't abort the whole migration;
it would simply leave `is_postgis_available()` returning false and radius
territories unavailable, with the other six territory types unaffected.
**Status**: adopted.

## ADR-033: Territory radius stored three ways: `center_geography`, `center_latitude`, `center_longitude`

**Context**: PostgREST returns PostGIS `geography` columns as WKB hex by
default, which the application's pure-JS matching/conflict-detection
functions (`modules/territories/match-territories.ts`) would have to parse
for no functional benefit — those functions exist specifically so radius
matching logic can be unit-tested without a live database or a WKB parser.
**Decision**: `territories` carries `center_geography geography(Point,4326)`
(for the real, database-backed `ST_DWithin` radius query, not yet wired
into a routing path since routing doesn't exist until Milestone 5) _and_
plain `center_latitude`/`center_longitude double precision` columns, kept
in sync by application code at write time (both are set together in
`createTerritory` and the territory-import confirm step — there is no
separate trigger, since only one write path exists). The pure-JS
`haversineDistanceMeters` matching function reads the plain columns; it is
a documented, deliberate approximation runs of the same radius-membership
question a live `ST_DWithin` query would answer, not a second source of
truth for geometry.
**Status**: adopted.

## ADR-034: Territory overlap detection covers same-type exact matches and radius/radius circle intersection only

**Context**: spec §24 item 1 asks for overlap warnings between "two active
territories," without restricting this to same-type pairs. Detecting a
real geographic overlap between, say, a `city` territory and a `radius`
territory would require knowing the city's actual polygon boundary — data
this milestone has no source for (spec §23 explicitly excludes "custom map
polygon drawing").
**Decision**: `detectOverlappingTerritories` only flags (a) two active
territories of the _same_ exact-match type whose matching fields are
identical (the concrete, always-determinable "accidental duplicate"
case), and (b) two active radius territories whose circles geometrically
intersect. Cross-type overlap (e.g. radius vs. city) is a documented,
out-of-scope limitation for this milestone, consistent with the "where
determinable" qualifier the spec itself applies to the related uncovered-
area warning (§24 item 6).
**Status**: adopted.

## ADR-035: Uncovered-area detection runs against observed lead locations, not hypothetical areas

**Context**: spec §24 item 6 asks for "an area has no configured fallback"
warnings "where determinable" — Milestone 4 has no complete enumeration of
"every possible area" to check coverage against, and inventing one (e.g.
every postal code in a country) is out of scope and impractical.
**Decision**: `detectUncoveredLocations` checks only postal codes/cities
that actually appear on submitted `leads` rows (grouped and counted) against
the active territory set, and reports any with zero matches as an
`information`-severity warning. This is the literal, always-determinable
reading of "where determinable" — coverage gaps are surfaced from real
submission data, not predicted for areas that have never sent a lead.
**Status**: adopted.

## ADR-036: Territory conflict/coverage detection runs on demand, not on a Cron schedule

**Context**: `docs/database-schema.md` §19 lists
`territories_without_users_count`/`territory_conflicts_count` as
`routing_health_metrics` columns, refreshed by Cron — but that table and
its refresh job belong to Milestone 9 (Production Readiness/routing
health), not this milestone.
**Decision**: `runTerritoryConflictDetection` is a plain, on-demand
org_admin server function (backing the Territories admin page's conflicts
view), computed fresh on each call rather than cached or scheduled.
Milestone 9's routing-health Cron job can call the same underlying pure
detection functions (`modules/territories/conflict-detection.ts`) to
populate its aggregate counts later, without duplicating the detection
logic.
**Status**: adopted.

## ADR-037: Routing engine logic lives in PL/pgSQL, with an equivalent pure-TypeScript module set kept only as a testable specification

**Context**: CLAUDE.md rule 21 requires `route_lead`/`accept_assignment`/
`decline_assignment`/`expire_assignment`/`reassign_lead` to run as
single-transaction database functions. But the deeper reason this has to be
true here specifically (not just a style preference) is the caller: Lead
intake (`record_lead_submission`, Milestone 3) is invoked by the `anon`
Postgres role with no session, and the spec requires a lead to be routed
immediately on submission. `anon` has no RLS read access to
`organization_users`, `user_availability`, `user_assignment_settings`,
`team_users`, `territories`, or any other table condition/eligibility
evaluation needs — a TypeScript orchestration layer issuing ordinary
RLS-scoped Supabase queries could not compute a routing decision for that
caller at all, session-less or not.
**Decision**: condition evaluation, eligibility filtering, territory
matching, and assignment-algorithm selection are implemented in PL/pgSQL
(`evaluate_routing_condition`, `compute_candidate_eligibility`,
`compute_routing_decision`, etc.), all `SECURITY DEFINER` so they can read
across the tables they need regardless of caller role, reachable only via
the narrow `route_lead`/`simulate_routing`/etc. entry points (never granted
to `anon` directly — `anon` reaches routing only transitively through
`record_lead_submission`'s internal call). A parallel, behaviorally
equivalent set of pure TypeScript modules (`src/modules/routing/*.ts`) was
still built, each mirroring one SQL piece 1:1 (`evaluate-conditions.ts` ↔
`evaluate_routing_condition`, `eligibility.ts` ↔
`compute_candidate_eligibility`, `assignment-algorithms.ts` ↔ the
direct/round-robin/weighted/fallback branches in `compute_routing_decision`,
`working-hours.ts` ↔ `is_within_working_hours`). These TS modules are not a
second production code path — nothing in the app calls them for a live
routing decision — they exist purely as a fast, dependency-free,
always-runnable specification of the same rules, unit-tested without a
database. **The SQL is the single source of truth; the TypeScript is
documentation-as-tests.** Any future change to a rule must be made in both
places, and a divergence between them is a bug in the TypeScript mirror,
not a legitimate alternate behavior.
**Status**: adopted.

## ADR-038: Locking and transaction decisions in the routing engine

**Context**: CLAUDE.md rule 21 and the Milestone 5 kickoff both require the
routing transaction to be deterministic, transactional, and safe under
concurrent requests, with round-robin state updated atomically and no more
than one active assignment per lead ever created. This ADR is the explicit
record of every locking/transaction decision made to satisfy that,
requested by name in the kickoff ("document all locking and transaction
decisions").
**Decision**, by function:

- **`route_lead(p_lead_id)`**: takes `SELECT ... FOR UPDATE` on the `leads`
  row first, before anything else, purely to serialize two concurrent
  `route_lead` calls for the _same lead_ (e.g. a retried intake request
  racing the routing hook). It then re-checks for an existing active
  assignment (`status in ('pending','notified','viewed')`) and returns
  `{outcome: 'already_assigned', ...}` immediately if found — this makes
  `route_lead` idempotent under real concurrency, not just by convention.
- **Eligibility computation** (`build_lead_routing_context`,
  `compute_candidate_eligibility`, condition evaluation) takes **no locks**.
  These are all plain reads across `organization_users`,
  `user_availability`, `user_assignment_settings`, `team_users`,
  `territories`, past `assignments` rows, etc. None of these rows are being
  concurrently mutated by another routing decision in a way that would
  produce an incorrect _eligibility_ result if read without a lock — worst
  case, a concurrent capacity change is observed slightly early or late,
  which is acceptable (capacity limits are a soft routing preference, not a
  correctness invariant the way "at most one active assignment" is).
  Locking every table involved in eligibility would make the transaction
  far more contention-prone for no correctness benefit.
- **`routing_state` (round-robin/weighted-round-robin cursor)**: locked with
  `SELECT ... FOR UPDATE` at the single moment a real assignment is about to
  be made — after eligibility and rule matching are already resolved, right
  before the algorithm picks a user and the cursor advances. This is the
  narrowest possible lock window: two concurrent `route_lead` calls for
  _different_ leads landing on the same team's round robin will serialize
  only for the brief read-modify-write of the cursor, not for the entire
  eligibility computation. The cursor update
  (`on conflict (organization_id, team_id, routing_flow_id) do update set
rotation_cursor = rotation_cursor + 1, last_assigned_user_id = ...`) is a
  single atomic upsert inside the same transaction as the lock.
- **Duplicate-assignment prevention is unconditional, not merely
  lock-derived**: a partial unique index,
  `assignments_one_active_per_lead_idx on assignments(lead_id) where status
in ('pending','notified','viewed')`, is the actual database-level
  guarantee — belt-and-suspenders on top of the `leads` row lock and the
  pre-insert existence check. `route_lead`'s insert is wrapped in
  `exception when unique_violation`, which re-selects and returns the
  assignment the _other_ concurrent transaction actually created, rather
  than raising an error to the caller. This means the single-active-
  assignment invariant holds even if the `leads` row lock were ever
  bypassed or a future code path forgot to take it — the constraint does
  not depend on any particular caller locking correctly.
- **`simulate_routing`** takes no locks and performs no writes: it calls the
  same `compute_routing_decision(p_lead_id, p_lock_state => false)` core as
  `route_lead`, which skips the `routing_state` lock entirely and returns
  the decision without touching `assignments`/`activities`/
  `manual_review_items`/`routing_state`. Simulator/live parity is
  guaranteed by construction (one shared function, one boolean flag).
- **`publish_routing_flow`**: no explicit row lock; it runs as a single
  `insert ... select` snapshot of the flow's current rules into
  `routing_flow_versions`/`routing_rule_versions` followed by one `update`
  on `routing_flows`, all in one statement-level-atomic transaction.
  Concurrent publishes of the _same_ flow are not a scenario the spec
  requires protecting against (publishing is an infrequent, single-admin
  admin action); if it did happen, Postgres's normal MVCC would still
  produce two internally-consistent versions, just with an unspecified
  "last write wins" ordering on `current_version_id` — acceptable, and
  irrelevant to lead-routing correctness since published versions are
  immutable once created regardless of ordering.
  **Status**: adopted. Verified under real concurrent load (30 leads routed
  concurrently against a 3-agent round robin) against a local Postgres 16
  instance, producing an exact 10/10/10 distribution and zero duplicate
  active assignments — see the Milestone 5 section of
  `docs/implementation-plan.md`.

## ADR-039: `compute_routing_decision` uses explicit scalar variables instead of a `record`, after a real not-yet-assigned-record crash

**Context**: real-execution testing (see ADR-038) against a local Postgres
instance surfaced a genuine bug: `compute_routing_decision` originally
declared `v_matched_rule record` and assigned it inside the rule-evaluation
loop, then branched on `v_matched_rule.id is not null` afterward. When a
routing flow's published version has zero rules (a valid, real scenario —
e.g. a freshly published empty flow), the loop body never runs, so
`v_matched_rule` is never assigned, and accessing `.id` on an unassigned
`record` raises `record "v_matched_rule" is not assigned yet`, crashing
both `route_lead` and `simulate_routing` for any such flow.
**Decision**: replaced the single `record` variable with three explicit
nullable scalars (`v_matched_rule_id uuid`, `v_matched_rule_action jsonb`,
`v_matched_rule_recipient_requirements jsonb`), each defaulting to `null`
and assigned individually inside the loop. A `null` matched-rule id now
correctly and safely falls through to the manual-review-fallback path
(`no_matching_rule`) instead of crashing. Re-verified after the fix: a
zero-rule flow produces `{"outcome": "manual_review", "manualReviewReason":
"no_matching_rule", ...}` and a corresponding `manual_review_items` row, as
intended.
**Status**: adopted.

## ADR-040: `organization_users`/`organizations` RLS policies fixed to close a self-referencing-policy infinite recursion, discovered only once real Postgres execution became available

**Context**: Milestone 5's real-database verification work (ADR-037/038)
included, as due diligence, actually running the pre-existing Milestone
1-4 RLS integration test suites against a real local Postgres for the
first time ever — every earlier session had `TEST_DATABASE_URL` unset, so
`describe.skipIf(!TEST_DATABASE_URL)` silently skipped all of them,
meaning these policies had never actually been executed by any test since
Milestone 1. Doing so surfaced a real, previously undetectable bug: the
foundation migration's `organizations_select_active_member`,
`organizations_update_org_admin`, `organization_users_select_fellow_member`,
and `organization_users_update_org_admin` policies each inline a raw
`exists (select 1 from organization_users ...)` subquery, predating the
`is_active_org_member()`/`is_org_admin()` `SECURITY DEFINER` helpers ADR-021
introduced in Milestone 2 specifically to avoid this. Because
`organization_users` has RLS enabled, evaluating that inline subquery
re-invokes `organization_users`' own SELECT policy — which contains the
same subquery — and Postgres correctly detects this as unbounded
recursion: `infinite recursion detected in policy for relation
"organization_users"`. Reproduced directly via `psql`: any authenticated
read of `organizations`, and any `UPDATE` attempt on `organization_users`
(including a non-admin agent's own no-op self-promotion attempt, which
should simply affect zero rows) both threw this error instead of behaving
correctly.
**Decision**: added
`20260806190000_fix_organization_users_rls_recursion.sql`, which drops and
recreates all four affected policies to call `is_active_org_member(...)`/
`is_org_admin(...)` instead of inlining the subquery — exactly the pattern
Milestone 2 already uses for every other tenant table. Since `SECURITY
DEFINER` functions run as their owning role (the migration-applying role,
which owns these tables and therefore bypasses RLS on them), the helper's
internal query no longer re-triggers the policy it's being called from,
breaking the recursion. This is a new forward-only migration, not an edit
to the already-shipped foundation migration, per CLAUDE.md rule 9. Two
further issues turned up by the same testing pass were determined to be
test-authoring bugs, not product bugs, and were fixed in the test files
only: `rls-tenant-isolation.test.ts`'s "hides all organizations once the
membership is inactive" test performed its status-change `UPDATE` with no
`auth.uid()` set at all, which incorrectly tripped
`enforce_self_accept_invitation_only` (ADR-023) — fixed by running that
update as the fixture's real org_admin, and by briefly disabling the
trigger only to restore fixture state afterward; and its
"rejects bootstrap_organization()" test issued a plain follow-up
`reset role` after a deliberately-rejected query, which cannot succeed once
Postgres has aborted the transaction (`25P02`) — fixed by removing that
line and relying on the per-test `SAVEPOINT` cleanup (see the comment atop
`tests/integration/milestone2-rls.test.ts`) to restore role/transaction
state instead.
**Status**: adopted. All 18 pre-existing Milestone 1-4 integration tests
plus the 6 new Milestone 5 tests pass together (24/24) against a freshly
migrated local Postgres 16 database after this fix. Takeaway for future
milestones: a table's _own_ RLS policies must go through the same
`SECURITY DEFINER` helper functions as every other table's policies that
reference it — inlining the check "just this once" is exactly how this
kind of recursion hides until something finally executes it for real.

## ADR-041: Email sending lives behind a swappable `EmailAdapter`; no ESP is wired in yet

**Context**: Milestone 6 requires "email notification queue entries" and
agents "should receive an email notification," but no email service
provider (Resend/SendGrid/SES/Postmark/etc.) is part of CLAUDE.md's
approved stack, and adding one is exactly the kind of new-provider decision
that needs explicit sign-off — the same situation ADR-003 (CRM credential
encryption via Supabase Vault) and ADR-004 (rate limiting) already
established a pattern for. `.env.example`/`lib/env/server.ts` have carried
placeholder `EMAIL_PROVIDER_API_KEY`/`EMAIL_FROM_ADDRESS` variables since
Milestone 1, anticipating this exact moment without committing to a vendor.
**Decision**: `src/modules/notifications/email-adapter.ts` defines a
one-method `EmailAdapter` interface. `LoggingEmailAdapter` is the
production default until an ESP is chosen and approved — it never makes a
network call and never logs the message's `to`/`subject`/`body` (which may
contain lead-derived personal data, CLAUDE.md rule 18), only that a send
was attempted. `TestEmailAdapter` is an in-memory capture used by every
test in this milestone, satisfying the kickoff's explicit "do not send
real customer email during automated tests; use test adapters"
instruction. Swapping in a real ESP later is a one-file change (a new
`EmailAdapter` implementation) with no change to the queue consumer,
resolver, or any test.
**Status**: adopted. Choosing and wiring a real ESP is an open decision
for a future milestone, tracked the same way ADR-003's Vault decision is.

## ADR-042: pgmq/pg_cron best-effort enabled like PostGIS; queue access goes through narrow wrapper functions, not pgmq directly

**Context**: this is the first milestone that needs Supabase Queues/Cron.
Neither `pgmq` nor `pg_cron` is installable in this project's local
sandbox Postgres (no apt package for either, confirmed by attempting
`create extension`), mirroring Milestone 4's PostGIS situation exactly —
both extensions ship on real Supabase projects but not here. Separately,
`pgmq`'s own functions (`pgmq.send`/`pgmq.read`/`pgmq.delete`/
`pgmq.archive`) live in the `pgmq` schema, which PostgREST does not expose
by default, and exposing raw queue primitives to any authenticated
Postgres role would let a client bypass the dedupe/authorization logic
this milestone depends on.
**Decision**: both extensions are enabled with the same
`do $$ ... exception when others $$` best-effort pattern as Milestone 4's
PostGIS (ADR-032), with live `is_queue_available()`/`is_cron_available()`
capability checks gating every code path that touches them — an
environment without pgmq still runs `route_lead`, `accept_assignment`,
etc. correctly; it just doesn't actually enqueue a message (the
`integration_jobs` dedupe row is still written, so the business-logic
idempotency guarantee holds regardless of queue availability). Queue
access from TypeScript goes through three narrow `SECURITY DEFINER`
wrapper functions —`dequeue_assignment_notifications`,
`ack_assignment_notification`, `fail_assignment_notification` — granted
only to `service_role`, never `authenticated`/`anon`. This is also why
`src/modules/notifications/**` and
`src/app/api/internal/**` are the only additions to the ESLint
service-role import allow-list this milestone: the notification consumer
is an internal system process acting across organizations/users, not a
request scoped to one caller, the same rationale already established for
`src/modules/users`/`src/modules/imports` (ADR-020).
**Status**: adopted. Local verification (real Postgres, no pgmq) confirms
`route_lead` and friends still work end-to-end with `is_queue_available()`
returning false; the pgmq-specific send/read/delete/archive calls
themselves can only be exercised on a real Supabase project.

## ADR-043: Notification idempotency has two layers — producer dedupe and consumer redelivery guard — and accepts pgmq's at-least-once semantics rather than chasing exactly-once

**Context**: spec/kickoff requires "every queue message ... must be
idempotent" and explicitly lists "repeated job delivery" as a required
test scenario. pgmq, like most queue systems, is at-least-once: a message
becomes invisible for a visibility-timeout window after being read, then
reappears if never deleted — so a consumer that crashes after doing its
work but before acknowledging will see that same message again.
**Decision**: two independent guarantees, not one:

1. **Producer-side dedupe** (prevents a _duplicate event_ from ever being
   enqueued twice): `enqueue_assignment_notification` inserts into
   `integration_jobs` with `on conflict (queue_name, dedupe_key) do
nothing` before calling `pgmq.send` — e.g. calling `route_lead` twice
   for an already-assigned lead never enqueues a second
   `new_lead_assignment` notification, verified directly
   (`tests/integration/milestone6-assignment-lifecycle.test.ts`,
   "enqueue_assignment_notification is idempotent").
2. **Consumer-side redelivery guard** (prevents _reprocessing the same
   message_ after it was already fully handled):
   `processAssignmentNotificationBatch` checks a `JobStatusChecker` before
   doing any work and skips straight to acking if the job is already
   `completed` — verified at the unit level with `TestJobStatusChecker`
   (`tests/unit/notifications/process-assignment-notifications.test.ts`,
   "repeated job delivery").
   Neither guarantee, alone or combined, closes the one genuine race
   inherent to at-least-once delivery: a crash between successfully sending
   the email/recording the notification and calling `ack` (which is what
   marks the job `completed`). In that narrow window a redelivered message
   would still reprocess and could produce one extra notification row/email.
   This is accepted as a documented, rare tradeoff rather than solved with a
   more complex two-phase-commit-style design — an occasional duplicate
   "you have a new lead" notification is a minor UX blemish, not a
   correctness or safety issue (it never duplicates the underlying
   assignment, which has its own unconditional database-level guarantee from
   Milestone 5's ADR-038).
   **Status**: adopted.

## ADR-044: Notification retry schedule — exponential backoff, 5 attempts, then dead-letter

**Context**: kickoff requirement 20 ("retry and dead letter behavior") and
spec §41's job status lifecycle need a concrete schedule for the
`assignment_notifications` queue specifically. Spec §43 only specifies a
schedule for _webhook_ retries (1m, 5m, 30m, 2h, 12h) — a much longer
window appropriate for an external endpoint that might be down for hours.
Assignment notifications are internal and time-sensitive (the whole point
is telling an agent about a lead quickly), so reusing the webhook schedule
verbatim would be wrong.
**Decision**: `fail_assignment_notification` uses a short exponential
backoff — `least(60, 2^attempt)` minutes, i.e. 2m, 4m, 8m, 16m, capped at
60m — and moves the job to `dead_letter` (archiving the pgmq message)
after 5 attempts. A separate periodic `dead-letter-sweep` Cron job is
deliberately _not_ added for this queue: unlike Milestone 8's future
`crm_sync`/`outbound_webhooks` queues (which need a scan across many
independently-scheduled `next_retry_at` values), `fail_assignment_
notification` decides dead-letter status inline, synchronously, at the
moment the final attempt fails — there is nothing left for a sweep to
find.
**Status**: adopted.

## ADR-045: Manual assignment/reassignment share one core function; a `cancelled` assignment is not a decline signal

**Context**: kickoff requirements 13-14 (administrator manual
assignment/reassignment, spec §35 items 8-9) are nearly identical
operations — the only difference is whether an active assignment already
exists to supersede — and both need to record a different activity type
(`manual_assignment` vs `manual_reassignment`) for the timeline. Separately,
superseding an active assignment needs a status that will _not_ trigger
Milestone 5's `PREVIOUSLY_DECLINED` exclusion the next time this lead is
(re-)routed automatically — an admin overriding routing isn't the assignee
declining the lead, and treating it as one would permanently and
incorrectly exclude that user from ever receiving this lead again through
normal routing.
**Decision**: `manually_assign_or_reassign_lead(lead_id, user_id, team_id,
activity_type)` is the single internal core (`service_role`-only),
wrapped by two public, `authenticated`-granted RPCs —
`manually_assign_lead`/`manually_reassign_lead` — that just supply the
right `activity_type` literal. It transitions any existing active
assignment to `'cancelled'`, a status Milestone 5's `compute_candidate_
eligibility` deliberately does not check when computing the
`PREVIOUSLY_DECLINED` exclusion (only `'declined'`/`'expired'` do).
Authorization (org_admin, or a permitted team_manager when a team is
specified) is enforced inside this core function itself, following the
same pattern as `route_lead`/`accept_assignment` — never left to RLS alone
for a write this consequential.
**Status**: adopted. Verified directly against real Postgres: manual
assignment sets `assignment_algorithm = 'manual'`, resolves any open
`manual_review_items` for the lead, and records a `manual_assignment`
activity (`tests/integration/milestone6-assignment-lifecycle.test.ts`,
scenario 11).

## ADR-046: Routing health metrics computed live, not read from a Cron-populated table

**Context**: Milestone 7 needs the 18 spec §45 routing health metrics
available on demand for the dashboard. A Cron job could periodically
compute and store them in `routing_health_metrics`, but the dashboard
would then show stale numbers between runs, and would show nothing at all
for an organization before the first Cron tick — the same problem
Milestone 4's conflict/coverage detection solved with ADR-036 ("compute on
demand").
**Decision**: `compute_routing_health(org_id, bucket_start, bucket_end)` is
a `stable security definer` function that computes all 18 metrics live via
SQL aggregates against `leads`, `assignments`, `manual_review_items`,
`user_assignment_settings`, `user_availability`, `territories`, and
`assignment_attempts` — the dashboard page calls it directly for its
window (this milestone: trailing 24 hours) rather than reading a table.
`routing_health_metrics` still exists, populated on a best-effort 5-minute
Cron schedule (`refresh_routing_health_metrics`, guarded by
`is_cron_available()` exactly like Milestone 6's notification/expiry
Crons) purely for future historical-trend charts — nothing in this
milestone reads from it.
Two metrics (`crm_sync_failures`, `webhook_failures`) always report `0`:
their source tables (`integration_logs`, `webhook_deliveries`) don't exist
until Milestone 8. `territories_without_users_count` and
`territory_conflicts_count` use a simpler structural approximation (no
`territory_users`/`territory_teams` rows; duplicate territory-field
tuples) than the full detection logic in
`modules/territories/conflict-detection.ts`, which remains the source of
truth for the Territories admin page — recomputing that page's full
algorithm as a health-dashboard subquery was judged not worth the
duplication for a monitoring number.
**Status**: adopted.

## ADR-047: Routing health dashboard is not team-scoped for a team_manager (known gap)

**Context**: `docs/permissions-matrix.md` specifies a `team_manager` should
see routing health for their permitted teams only, while an `org_admin`
sees the whole organization. `compute_routing_health` takes only
`organization_id` — none of its 18 subqueries join through
`leads.assigned_team_id` or an equivalent team filter.
**Decision**: Ship without team-scoping for this milestone.
`modules/routing-health/routing-health.ts` restricts the dashboard to
org_admin and team_manager (agents are rejected, matching the matrix), but
a team_manager currently sees the same org-wide numbers an org_admin does.
Reworking all 18 subqueries to accept and apply a team filter is real SQL
work, not a UI change, and was judged out of scope for this pass given the
rest of Milestone 7's surface area. Tracked here as a known limitation,
not silently shipped — a future pass should add an optional
`p_team_id` parameter to `compute_routing_health` and thread it through
each metric that has a `leads`/`assignments` row to filter by team.
**Status**: accepted gap, not resolved.

## ADR-048: Lead status definitions are seeded per-organization, not a single global set

**Context**: spec §37 lists 9 default lead statuses
(`new`/`assigned`/`accepted`/`contact_attempted`/`contacted`/`qualified`/
`unqualified`/`converted`/`lost`), but also implies statuses are
org-configurable going forward (the `lead_status_definitions` table has an
`organization_id` column, `active` flag, and `sort_order`) — a single
hardcoded global enum would block that.
**Decision**: `seed_default_lead_statuses(organization_id)` inserts the 9
defaults for one organization, `on conflict (organization_id, key) do
nothing` so it's safe to call more than once. It runs in two places:
(1) a one-time backfill in the Milestone 7 migration for every
organization that existed before this migration, and (2) a new call
inside `bootstrap_organization` (extended via `create or replace`, body
otherwise unchanged from Milestone 1) so every organization created from
this point on gets the same 9 defaults automatically. `leads.lead_status`
itself stays a plain `text` column (a Milestone 3 decision, unchanged) —
`update_lead_status` validates against `lead_status_definitions` at
write time rather than a database-level foreign key, so an org_admin can
still deactivate a status without an FK constraint blocking it.
**Status**: adopted.

## ADR-049: Original raw submission payload is gated in application code, not solely by `submission_logs` RLS

**Context**: `docs/permissions-matrix.md` requires the original raw
payload (spec §36.3 item 9) visible to `org_admin` only, and marks its
enforcement layer "Server" specifically (not "RLS" or "Both") — a
narrower requirement than everything else on the lead detail page, which
`leads_select_scoped`-style RLS already handles.
**Decision**: `getLeadDetail` (`src/modules/leads/get-lead-detail.ts`)
checks `membership.role === "org_admin"` in application code before even
querying `submission_logs`, rather than depending only on that table's
existing org_admin-only RLS policy. This is deliberate defense in depth:
`submission_logs` RLS is already org_admin-only today, but the payload
question is specifically about a human viewing it through this one page,
not about what the row's RLS generally allows — a future relaxation of
`submission_logs` RLS for some other legitimate reason (e.g. letting a
team_manager see delivery status without the payload) must not silently
reopen payload visibility here too.
**Status**: adopted.

## ADR-050: Playwright introduced at Milestone 7, ahead of its spec-scoped Milestone 9 ("pre-pilot")

**Context**: `docs/testing-strategy.md` scoped Playwright to Milestone 9
per the original spec. The Milestone 7 kickoff explicitly asked for
"Playwright tests for the most important user journeys" and accessibility
checks "where practical," overriding that schedule for this one
milestone's UI surface.
**Decision**: `@playwright/test` and `@axe-core/playwright` are added as
dev dependencies now. `tests/e2e/` covers five journeys (dashboard, lead
list search/empty-state, lead detail view/note/status-change, manual
review resolve, routing simulator run) plus an automated axe-core
WCAG 2 A/AA scan of the five new pages. These tests need a real running
app and a real seeded Supabase project (same reasoning as
`tests/integration`'s real-Postgres approach — RLS/auth can't be
meaningfully faked), so they are not wired into `npm test` or CI; every
spec calls `test.skip(...)` up front when the required `E2E_*` env vars
are absent (see `tests/e2e/README.md`), verified locally by running the
full suite without those vars and confirming all 11 tests skip cleanly.
Milestone 9 remains the point at which Playwright becomes a CI gate with
broader coverage across the rest of the app — this is an early, narrow
slice of that eventual scope, not a replacement for it.
**Status**: adopted.

## ADR-051: Integration secret encryption is application-level AES-256-GCM, not Supabase Vault (resolves ADR-003)

**Context**: ADR-003 flagged CRM credential/webhook secret encryption as
"proposed — confirm Vault is available on the target Supabase plan before
Milestone 8." Milestone 8 is now that milestone. Supabase Vault needs
per-environment setup through the Supabase dashboard/Vault API that this
codebase has no way to provision or verify automatically, and its
management story adds real operational surface (key rotation, access
policies) disproportionate to what Phase 1 needs. The alternative
considered — `pgcrypto`, passing a plaintext secret into a Postgres
function argument for `pgp_sym_encrypt` — was rejected because that
plaintext would then appear in Postgres query logs and `pg_stat_statements`,
undermining the entire point of encrypting it.
**Decision**: `lib/crypto/secret-box.ts` encrypts CRM credentials and
webhook secrets in Node, before anything reaches Postgres, using
AES-256-GCM keyed by `WEBHOOK_ENCRYPTION_KEY` (server-only env var, hashed
with SHA-256 so operators can set it to any passphrase rather than an
exact 32-byte value). `integration_connections.credentials_encrypted` and
`webhook_endpoints.secret_encrypted` are `text` columns (not `bytea`) —
Postgres only ever sees or returns opaque hex ciphertext, produced and
consumed exclusively by this one module, and the `text` type sidesteps any
ambiguity in how a JS client would encode binary over PostgREST. This
resolves ADR-003's "proposed" status without adding Supabase Vault.
**Status**: adopted, ADR-003 superseded by this decision.

## ADR-052: Milestone 8's lifecycle events fire via AFTER triggers, not by editing the M3/M5/M6/M7 core transactional functions

**Context**: `crm_sync`/`outbound_webhooks` jobs need to be enqueued the
moment a lead is created, an assignment is created/accepted/declined, or a
lead's status changes — events that already happen inside
`record_lead_submission` (M3), `route_lead`/`reassign_lead` (M5),
`accept_assignment`/`decline_assignment`/`manually_assign_or_reassign_lead`
(M6), and `update_lead_status` (M7). The session's standing hard rule —
"do not continue when concurrency tests fail; routing concurrency failures
are release blocking" — means any edit to those functions carries real
risk to already-verified, concurrency-sensitive behavior (round-robin
locking, the partial-unique-index assignment guarantee).
**Decision**: add zero lines to any of those functions. Instead, `AFTER
INSERT`/`AFTER UPDATE OF status` triggers on `leads`, `assignments`, and
`lead_status_history` call the new generic `enqueue_integration_job(...)`
directly from the row that was just written — they fire inside the same
transaction as the write that caused them (so they roll back together,
same atomicity guarantee a hand-added `perform enqueue_...` call inside
those functions would have had), but never touch those functions' own
bodies, locking, or logic. Verified directly against real Postgres
(`tests/integration/milestone8-integrations.test.ts`): a lead insert
enqueues `lead.created`/`sync_contact`; a second assignment for an
already-assigned lead enqueues `lead.reassigned` rather than
`lead.assigned`; an assignment transitioning to `accepted` enqueues
`lead.accepted`/`sync_accepted_status`; a `lead_status_history` insert to
`converted`/`lost` enqueues both `lead.status_changed` and the specific
`lead.converted`/`lead.lost` event.
**Status**: adopted.

## ADR-053: The one CRM adapter is a generic, settings-configured HTTP/OAuth2 adapter, not a named vendor's API

**Context**: spec §42 says "Phase 1 should implement one direct CRM
adapter" but names no specific provider, and neither did the Milestone 8
kickoff. Committing to a named vendor (HubSpot, Salesforce, Pipedrive,
...) would mean writing against that vendor's exact REST contract from
memory, with no way to verify correctness against real, current API
documentation in this environment — a real risk of shipping confidently
wrong request shapes.
**Decision**: `HttpCrmAdapter` implements all ten required methods
(`connect`, `disconnect`, `testConnection`, `listUsers`,
`createOrUpdateContact`, `assignOwner`, `updateStatus`, `createNote`,
`handleWebhook`, `refreshCredentials`) against a generic REST shape fully
driven by `integration_connections.settings` (base URL, resource paths,
auth header/scheme, inbound webhook secret and field names) and
`credentials` (access/refresh token). `CRM_CLIENT_ID`/`CRM_CLIENT_SECRET`
(already-declared server env vars) are the one app-level OAuth2 client
registration shared across every org's connection to a given provider —
the normal shape of a multi-tenant OAuth integration. Pointing this
adapter at a real, named CRM is a configuration exercise (settings values)
for whenever a specific provider is chosen, not a code change. All
automated tests use `TestCrmAdapter` (in-memory, records every call)
exclusively — the kickoff explicitly forbids connecting a real production
CRM during automated testing.
**Status**: adopted.

## ADR-054: crm_sync/outbound_webhooks retries drain from the existing `integration_jobs` ledger, not a third literal pgmq queue

**Context**: `docs/background-processing.md`'s original table lists
`integration_retries` as a "queue" whose consumer "re-drives failed
integration or webhook jobs on the retry schedule." Spec §43's retry
schedule (1m, 5m, 30m, 2h, 12h) is human-scale, unlike
`assignment_notifications`' short pgmq-visibility-timeout retries (M6) —
leaving a failed message sitting invisible in a pgmq queue for up to 12
hours doesn't fit pgmq's intended usage pattern.
**Decision**: `fail_integration_job` always archives the failed pgmq
message (removing it from the visible queue) and records `next_retry_at`
on the `integration_jobs` row per the spec §43 schedule; a single
parameterized `drain_integration_retries(queue_name)` — wrapped as
`run_drain_crm_sync_retries()`/`run_drain_webhook_retries()` for Cron —
re-sends a fresh pgmq message for any row whose `next_retry_at` has
passed. There is no separate `integration_retries` pgmq queue: the retry
schedule is realized entirely against the shared ledger already backing
every queue since Milestone 6, which is simpler than a third queue and
was already the ledger's designed purpose (see that migration's own
comment anticipating this reuse). Verified against real Postgres that
`drain_integration_retries` re-queues only rows whose delay has elapsed,
leaving not-yet-due retries untouched.
**Status**: adopted.

## ADR-055: The inbound CRM webhook route uses the anon client + two narrow SECURITY DEFINER functions, never the service-role client

**Context**: `POST /api/webhooks/crm/[connectionId]` is a second pre-auth
request path alongside `POST /api/v1/intake/[sourceToken]` (ADR-011) — a
CRM pushing a status change has no user session behind it, yet the route
needs to read a connection's encrypted credentials/settings (RLS-gated,
org_admin-only data) and write a lead status change on behalf of no
authenticated user. Reaching for the service-role client here — the
obvious shortcut, and the one this codebase's internal Cron-invoked queue
routes legitimately use — would be exactly the kind of public,
unauthenticated route the ESLint `no-restricted-imports` rule (ADR-022)
exists to keep that client off of.
**Decision**: the route uses `createAnonSupabaseClient()` (same client
`POST /api/v1/intake/[sourceToken]` uses) plus two new narrow SECURITY
DEFINER functions granted to `anon`: `get_connection_for_inbound_webhook`
(read-only, returns only a connected connection's provider/settings/
encrypted credentials) and `apply_inbound_crm_status_change` (validates
the CRM's status against the connection's own `settings.statusMapping`,
then updates the lead — duplicating a small amount of `update_lead_status`
rather than calling it, since that function relies on the caller's own
`auth.uid()`/RLS context, which an anonymous, signature-verified request
doesn't have). Real authorization is entirely the adapter's own signature
verification inside `handleWebhook`, using the connection's stored secret,
before either function is ever called — mirrors `resolve_lead_source`/
`record_lead_submission`'s exact pattern. Only statuses present in a
connection's own admin-configured `statusMapping` are ever applied — spec
§42 item 7's "selected" lead status changes, not any string a CRM sends.
**Status**: adopted.

## ADR-056: Fixed a round-robin first-assignment race condition found by Milestone 9's higher-parallelism concurrency review

**Context**: Milestone 9's concurrency review re-ran the release-blocking
routing scenarios (spec §54) at higher parallelism than Milestone 5's
original verification (ADR-038: 30 leads / 3 agents, run sequentially
enough to never race the very first assignment for a team+flow). The new
test (`tests/integration/milestone9-concurrency.test.ts`) routes 60 leads
genuinely concurrently — real, separate Postgres connections, real
`Promise.all` — against a fresh 5-agent round robin. On the first run this
produced a 13/12/12/12/11 split instead of the required exact 12 each, and
the "no unresolved critical security issue" / "all release-blocking tests
pass" bars in this milestone's definition of done mean this could not be
waved through.
**Root cause**: `compute_routing_decision`'s round-robin/weighted-round-
robin branch (and the identical team-fallback branch) issued `select ...
from routing_state where ... for update` to read and lock the rotation
cursor. `SELECT ... FOR UPDATE` against a query that matches zero rows
takes no lock — there is no row to lock. The very first routing decision
ever made for a given (organization, team, flow) has no `routing_state`
row yet, so multiple concurrent `route_lead` calls landing on that same
"row doesn't exist yet" state all independently read
`last_assigned_user_id is null` and all pick the same first candidate,
rather than serializing on who goes first. ADR-038's locking design was
correct for every assignment _after_ the first; the gap was specifically
the bootstrap case, which a smaller/slower concurrent load (M5's original
check) never happened to hit.
**Decision**: `20260813080000_milestone9_routing_state_race_fix.sql`
replaces `compute_routing_decision` to `insert into routing_state (...)
... on conflict (organization_id, team_id, routing_flow_id) do nothing`
immediately before each `for update` read, whenever `p_lock_state` is
true. Postgres serializes concurrent inserts on the same conflict key (a
second concurrent insert blocks until the first commits, then sees the row
and no-ops), so by the time any caller reaches the following `for update`,
the row is guaranteed to exist and locks exactly as originally intended —
including for the very first assignment. `simulate_routing`
(`p_lock_state = false`) is unaffected: it still takes no lock and writes
nothing, unchanged from ADR-038.
**Verification**: with the fix applied, the same 60-concurrent-lead test
produces an exact 12/12/12/12/12 split and zero duplicate active
assignments; a second test in the same file races 25 concurrent
`route_lead` calls against one lead (exactly one gets `assigned`, the rest
`already_assigned`); a third races 20 concurrent `simulate_routing` calls
against 10 concurrent real `route_lead` calls and confirms the simulated
lead never gets an assignment and the rotation cursor advances by exactly
10, not 30. Per the standing project rule "do not continue when
concurrency tests fail — routing concurrency failures are release
blocking," this was root-caused and fixed rather than the test being
loosened.
**Status**: adopted.

## ADR-057: Grant table-level privileges to `authenticated`/`service_role` explicitly — no migration ever did, and Supabase no longer does it for you

**Context**: the CI/deployment-safety-checks PR turned on `supabase
start` + the full `tests/integration` suite in real GitHub Actions for the
first time (prior verification of this suite ran ad hoc against a
hand-provisioned local Postgres instance in a sandbox, not the actual
Supabase CLI). Every integration test file failed immediately with
`permission denied for table <name>`. Root cause:
`supabase/config.toml`'s own `auto_expose_new_tables` setting documents
that newly created public-schema tables are **no longer** automatically
granted to the `anon`/`authenticated`/`service_role` Data API roles —
"the new cloud default" is to require an explicit `GRANT`. No migration
across Milestones 1–9 ever issued one; every table's access has relied
entirely on RLS policies, which Postgres never even reaches without the
underlying table-level privilege existing first. This was invisible in
every prior local sandbox verification because that sandbox's Postgres
instance had grants applied by hand, once, outside any migration file —
worked around, never actually fixed.
**Decision**: `20260813090000_grant_table_privileges_to_data_api_roles.sql`
grants `SELECT, INSERT, UPDATE, DELETE` on every existing table to
`authenticated` and `service_role`, and sets
`ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES` so any table created by
a future migration gets the same grants automatically. `anon` receives no
table grants at all: every pre-auth code path (lead intake, inbound CRM
webhooks) calls a `SECURITY DEFINER` function via RPC rather than
querying a table directly (ADR-011, ADR-055), and a `SECURITY DEFINER`
function runs with its owner's privileges, not the caller's — confirmed
by grepping every `createAnonSupabaseClient` call site in `src/`, each of
which only ever calls `.rpc(...)`.
**Why this doesn't weaken tenant isolation or role scoping**: RLS remains
the real enforcement layer. A table-level grant only removes the
"Postgres denies the query before RLS is ever consulted" false negative;
it does not grant access to any row or command RLS itself doesn't already
allow. `audit_logs`, for example, has RLS policies for `SELECT` and
`INSERT` only — no `UPDATE`/`DELETE` policy exists, so those commands
still affect zero rows for every role, table-level grant or not, because
Postgres RLS denies any command with no matching permissive policy. This
is the same layered GRANT + RLS model Supabase's own documentation
recommends, not a new pattern introduced here.
**Verification**: applied against a fresh local Postgres instance with
all 12 migrations and no manual workaround grants of any kind — the full
`tests/integration` suite (63 tests across 9 files) passes cleanly, the
same result previously achieved only with hand-applied, undocumented
grants.
**Status**: adopted.

## ADR-058: Release-blocking fix — manual assignment never validated the target user/team belongs to the lead's organization

**Context**: the pre-pilot production readiness audit reviewed every
Server Action / DB function that takes a free-text identifier from an
authenticated admin, rather than deriving candidates from a scoped query
(as `route_lead`'s eligibility computation does). `manually_assign_lead`/
`manually_reassign_lead` (both thin wrappers over
`manually_assign_or_reassign_lead`) take a `p_user_id` and optional
`p_team_id` directly from the admin's form input (see
`src/modules/assignments/manual-assignment.ts`,
`src/modules/manual-review/manual-assign-form.tsx`) and had never checked
that either belonged to the lead's own organization — only that the
_caller_ was an `org_admin` (or a team_manager permitted for
`p_team_id`). An org_admin of organization A could submit any UUID at
all — a real user or team from organization B, or a value matching no
user/team — and the function would still create the assignment, update
`leads.assigned_user_id`/`assigned_team_id`, and fire
`enqueue_assignment_notification` targeting that user_id.
**Impact**: this is a genuine cross-tenant exposure, not just a
data-integrity nicety. `leads`/`assignments` RLS still protects the lead's
_own_ row from being read back by the foreign user (their
`organization_users` row for organization A doesn't exist), but the
notification itself — its title/body describing the lead, resolved and
delivered by `process-assignment-notifications` — is generated and
inserted directly, which RLS does nothing to stop since it's a targeted
write, not a read the foreign user performs themselves. Classified
**release blocking**: a real path for organization A's lead data to reach
a user account outside organization A.
**Decision**: `20260813100000_validate_manual_assignment_org_membership.sql`
adds two checks at the top of `manually_assign_or_reassign_lead`, before
any mutation: `p_user_id` must have an `active` `organization_users` row
for the lead's own `organization_id`, and if `p_team_id` is provided, it
must belong to that same organization. Both raise a clear exception
(`22023`) rather than silently no-op-ing.
**Verification**: added three tests to
`tests/integration/milestone6-assignment-lifecycle.test.ts` (11a/11b/11c —
foreign user, nonexistent user, foreign team) and confirmed all three
**fail against the pre-fix function** (proving they test real behavior,
not a vacuous assertion) and **pass with the fix applied**, alongside the
full existing suite (66/66 passing, no regressions).
**Root cause note**: this gap existed since Milestone 6 and was missed by
that milestone's own "cross-organization access" test (#12), which only
exercised _read_ access to `notifications`/`integration_jobs` as a
foreign-org admin — never the _write_ path of manually assigning a lead
to an arbitrary identifier. Recorded here so future manual-input
DB-function work checks organization membership explicitly rather than
assuming RLS alone covers write-side authorization.
**Status**: adopted.

## ADR-059: Database backups gap knowingly accepted for now, not resolved

**Context**: the production readiness audit (`docs/production-readiness.md`
§21) found the linked Supabase project is on the free tier, which has no
automatic backups or point-in-time recovery. This was originally
classified release blocking, since it cannot be closed by any engineering
work — only by upgrading the Supabase project's billing tier or explicitly
accepting the risk.
**Decision**: the person responsible for this decision has explicitly
chosen to accept zero recovery capability for now rather than upgrade the
tier. This is a deliberate, informed choice, not an oversight — recorded
here per CLAUDE.md rule 22 so the tradeoff and its owner are traceable
later, not just inferred from an unexplained absence of backups.
**Consequence**: if data is lost or corrupted (bad migration, application
bug, mistaken deletion, Supabase-side incident), there is currently no way
to restore it. `audit_logs`/`activities` (append-only) and periodic manual
export are the only mitigations, and neither is a substitute for a real
backup/restore capability.
**Status**: adopted — risk accepted, not resolved. Should be revisited
before any pilot scales beyond a small, trusted set of organizations, per
`docs/backup-and-restore.md`.

## ADR-060: Cron→app HTTP auth config moved from `app.settings.*` GUCs to an `app_private` table

**Context**: Milestones 6 and 8 scheduled `pg_cron`/`pg_net` jobs that
call the app's internal queue-processing routes, authenticating via an
`x-cron-secret` header built from two Postgres custom config settings,
`current_setting('app.settings.app_url', true)` and
`current_setting('app.settings.cron_secret', true)`. Both migrations'
comments said these had to be set via "Database Settings > Custom
Postgres Config, or via `alter database ... set ...`". Neither path
actually works on a real hosted Supabase project, discovered only while
following the deployment runbook against production: `alter database
postgres set app.settings.app_url = ...` fails with `permission denied
to set parameter "app.settings.app_url"` (Supabase reserves
`ALTER DATABASE`-level custom GUCs for its own management plane on
shared infrastructure, even for the project owner), and the dashboard's
"Database Settings" page has no "Custom Postgres Config" section on
current Supabase dashboards — that UI does not exist. Consequence: since
each job's `where current_setting(...) is not null` guard fails closed,
`process-assignment-notifications`, `process-crm-sync`, and
`process-outbound-webhooks` have been silently no-op'ing on every real
Supabase project since Milestone 6 — no error surfaced anywhere, since a
job that never fires produces no failure to observe.
**Decision**: replace both `current_setting('app.settings.*', true)`
lookups with a single-row table, `app_private.cron_http_config`
(`app_url text`, `cron_secret text`), set via a plain `UPDATE` from the
Supabase SQL Editor — an ordinary privileged operation the project owner
already has, unlike `ALTER DATABASE`. The table lives in a new
`app_private` schema rather than `public` specifically so Milestone 9's
blanket `grant select, insert, update, delete on all tables in schema
public to authenticated, service_role` (and its matching `alter default
privileges`, `20260813090000_grant_table_privileges_to_data_api_roles.sql`)
never reaches it — a secret used to authenticate Cron's own calls into
the app must never become readable by every authenticated tenant user
the way every other `public` table now is. `revoke all ... from public,
anon, authenticated, service_role` on the table itself is added as
defense in depth on top of the schema separation. See
`supabase/migrations/20260813110000_cron_http_config_table.sql` and
`docs/deployment-runbook.md` §3.
**Consequence**: the three previously-silent cron jobs need this new
migration applied and the config table populated on every existing
environment (dev/preview/production) before they start actually running
— this is not automatic for projects that already ran the Milestone
6/8 migrations. `docs/deployment-runbook.md` §3 was rewritten to walk
through this.
**Status**: adopted.
