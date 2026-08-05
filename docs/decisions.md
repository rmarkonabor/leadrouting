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

## ADR-002: Include the PostGIS extension despite it being absent from the
initial 17-item approved stack list

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

## ADR-007: Team manager scope defined by team membership, not a separate
grant table

**Context**: spec §8.2 says a team manager acts within "permitted teams"
but doesn't define how a team becomes "permitted" for a given manager.
**Decision**: `team_users` gets an `is_manager boolean default false`
column; a `team_manager`-role user's permitted teams are exactly the teams
where they have a `team_users` row with `is_manager = true`. This avoids a
redundant grants table and keeps team membership and management authority
in one place.
**Status**: proposed — confirm during Milestone 2 implementation and
update `docs/permissions-matrix.md`/`docs/database-schema.md` if a
separate grant table is chosen instead (e.g. to allow a manager to oversee
a team without being a member of it).

## ADR-008: Round-robin/weighted-round-robin concurrency safety via row
locking, not advisory locks or a separate scheduler

**Context**: spec §29.2–§29.3 and §54 require atomic rotation state under
concurrent routing requests.
**Decision**: `route_lead` takes `SELECT ... FOR UPDATE` on the relevant
`routing_state` row before reading/advancing the cursor, inside the same
transaction that creates the assignment. No advisory locks, no external
scheduler/queue-based serialization — plain row-level locking inside the
existing transaction.
**Status**: adopted.

## ADR-009: Webhook idempotency relies on a stored `event_id`, not
provider-side deduplication

**Context**: spec §43 requires idempotent delivery and replay protection.
**Decision**: every outbound webhook event gets a UUID `event_id`
generated at creation time and stored in `webhook_deliveries` under a
unique `(webhook_endpoint_id, event_id)` constraint; retries reuse the
same `event_id` rather than minting a new one. Receiver-side dedupe on
`event_id` is documented as the customer's responsibility.
**Status**: adopted.
