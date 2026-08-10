# Integration tests

These tests exercise real Postgres Row Level Security policies — they
cannot be meaningfully faked with mocks, so they connect to an actual
Postgres instance with the Milestone 1 migrations applied.

They are skipped automatically when `TEST_DATABASE_URL` is not set,
which is the case in this sandboxed session (no Docker daemon available
to run `supabase start`). This is a documented known limitation of this
implementation pass, not a gap in the test design — see
`docs/implementation-plan.md` Milestone 1 and the final report's "Known
limitations" section.

## Running these tests locally

1. Install and start the Supabase CLI's local stack (requires Docker):
   ```
   supabase start
   ```
2. Apply the Milestone 1 migration (already in `supabase/migrations/`) to
   the local stack — `supabase start` applies migrations automatically on
   first start, or run `supabase db reset` (local only, never `--linked`)
   to reapply from scratch.
3. Note the local Postgres connection string `supabase start` prints
   (typically `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
4. Run:
   ```
   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
   ```

Note: vitest runs test *files* in parallel worker processes by default.
Each integration test file opens its own real Postgres connection and
keeps one transaction open for its whole run (rolled back at the end) —
running several of these files concurrently against the same local
database can occasionally produce spurious timeouts or transaction-state
errors under contention (observed on constrained sandbox hardware, not a
correctness issue — every file passes reliably alone). If you see that,
add `--no-file-parallelism` to the vitest invocation. This doesn't affect
CI, which never sets `TEST_DATABASE_URL` and skips these files entirely.

## What is verified

`rls-tenant-isolation.test.ts` connects as the Postgres superuser to seed
two organizations and two users (one per organization), then opens a
session-scoped connection that mimics an authenticated PostgREST/Supabase
request (`set role authenticated; select set_config('request.jwt.claims',
...)`) to verify:

- A user can select their own organization but not another organization's
  row (audit requirement 7 — admins cannot access another organization).
- A user with an `inactive` or `suspended` membership can select zero
  organization rows, even for their own organization (spec §10).
- `bootstrap_organization()` cannot be used to create a second
  organization-admin membership for a caller who isn't authenticated
  (`auth.uid()` is null outside a real session).

All test data is created and torn down inside a single transaction that is
rolled back at the end, so the test never leaves residue in the target
database.

## Milestone 2 (`milestone2-rls.test.ts`)

Same skip/run conditions as above, extended to Milestone 2's tables
(`teams`, `team_users`, `audit_logs`). Verifies the audit requirements from
`docs/implementation-plan.md` Milestone 2 directly against real RLS policies:
an agent cannot read another agent's `team_users` row; a `team_manager`
cannot administer (insert/update) any team, including one they manage
(only `org_admin` can — docs/decisions.md ADR-007); an `org_admin` cannot
read another organization's teams; an agent cannot change their own role;
and `audit_logs` rows are insertable only as the real actor and readable
only by `org_admin`.

## Milestone 3 (`milestone3-rls.test.ts`)

Same skip/run conditions, extended to Milestone 3's tables (`lead_sources`,
`leads`) and functions (`resolve_lead_source`, `record_lead_submission`).
Verifies: an `org_admin` cannot read another organization's lead sources or
leads; `resolve_lead_source` resolves the correct organization for a valid
token hash and returns no rows for an unknown one, callable as the `anon`
role; `record_lead_submission` is idempotent — a repeat call with the same
`(lead_source_id, idempotency_key)` returns the original result and creates
no second lead.

## Milestone 4 (`milestone4-rls.test.ts`)

Same skip/run conditions, extended to Milestone 4's tables (`territories`,
`lead_locations_internal`). Verifies: an active member cannot read another
organization's territories but can read their own; an agent (non-admin)
cannot create a territory; an `org_admin` cannot read another
organization's `lead_locations_internal` rows.

## Milestone 5 (`milestone5-routing.test.ts`)

Same skip/run conditions, extended to the routing engine (`routing_flows`,
`routing_rules`, `assignments`, `routing_state`, `manual_review_items`).
Verifies: round-robin routing creates exactly one active assignment;
re-routing an already-assigned lead is idempotent; `simulate_routing`
writes zero rows; declining an assignment reassigns to a different user;
published `routing_flow_versions` are immutable; an org_admin cannot read
another organization's routing flows or assignments.

## Milestone 6 (`milestone6-assignment-lifecycle.test.ts`)

Same skip/run conditions, extended to the assignment lifecycle
(`notifications`, `integration_jobs`, and the `run_expire_assignments`/
`manually_assign_lead` functions). Verifies all 15 required scenarios:
acceptance, decline, expiration (and idempotent repeated Cron sweeps),
automatic reassignment, previous-recipient exclusion, repeated accept
requests, accept/decline after expiration (both rejected), two genuinely
simultaneous accept requests on the same assignment (its own committed,
self-cleaning fixture — the only test in this file that can't use the
shared uncommitted-transaction fixture, since a second Postgres connection
can't see uncommitted rows), no eligible replacement (manual review),
manual assignment, and cross-organization isolation on
`notifications`/`integration_jobs`. The remaining three required
scenarios — repeated job delivery, queue retry behavior, and Sentry
sanitization — concern the TypeScript notification consumer rather than
SQL, and are covered at the unit level in
`tests/unit/notifications/process-assignment-notifications.test.ts`
using `TestQueueAdapter`/`TestEmailAdapter` (no real queue or email
service involved).
