# Testing Strategy

Source: `docs/phase1-product-spec.md` §54. Vitest for unit/integration;
Playwright is introduced before customer pilots (Milestone 9), not from
day one.

## 1. Vitest categories (spec §54's 34 categories, grouped)

| Group | Categories | Notes |
|---|---|---|
| Identity & access | Authentication, Organization isolation, Row Level Security, Role permissions, User invitations, User deactivation, Team membership | RLS tests run against a local Supabase stack (`supabase start`), asserting queries as different simulated users/roles return correctly scoped rows |
| Recipients | Availability, Capacity, Custom variables, Recipient attributes | Unit tests on eligibility-filter pure functions plus integration tests against seeded data |
| Intake | Field mapping, Lead intake, Validation, Duplicate detection | Includes malformed/partial payloads, unknown-field handling modes, idempotency-key replay |
| Territory | Territory matching | Includes all seven territory types (spec §23), PostGIS radius matching with fixture coordinates |
| Routing | Routing rule matching, Direct assignment, Round robin, Weighted round robin, Assignment concurrency | Concurrency tests spin up parallel calls to `route_lead`/round-robin selection against the same seed data |
| Assignment lifecycle | Assignment acceptance, Assignment decline, Assignment expiration, Automatic reassignment, Manual review | Includes idempotent repeat accept/decline calls |
| Background processing | Queue idempotency, Cron idempotency | Replays the same queue message / re-runs the same cron sweep twice, asserts no duplicate side effects |
| Integrations | Webhook signatures, Webhook retries, CRM retries | Includes signature verification with tampered payloads, retry-schedule assertions |
| Operations | Sentry sanitization, Audit logs, Bulk imports | Sentry tests assert the `beforeSend` sanitizer strips every field in the spec §47 removal list from representative event fixtures |

Unit tests live colocated with the module (`modules/<name>/*.test.ts`) for
pure logic (condition evaluation, transformations, Zod schemas). Tests
that need a database run in `tests/integration` against the local Supabase
stack, torn down/reset between test files.

## 2. Release-blocking routing tests (spec §54, mandatory before any
milestone touching routing/assignments is called done)

1. Concurrent submissions cannot create duplicate active assignments for
   the same lead — verified via parallel `route_lead` calls plus the
   partial unique index.
2. Concurrent round robin requests cannot corrupt rotation state —
   verified via parallel assignment requests against one team, asserting
   the resulting distribution matches expected rotation order with no
   user skipped or doubled.
3. Historical routing versions remain unchanged after later edits/publishes
   to the same flow — verified by publishing v1, asserting a routed lead's
   stored `routing_flow_version_id` still resolves to v1's rules after v2
   is published.
4. Routing simulation does not change live data — verified by running
   `simulate_routing` and asserting zero rows changed in `leads`,
   `assignments`, `activities`, `routing_state`, `manual_review_items`.
5. Cross organization routing data cannot be accessed — verified by
   attempting routing/assignment reads and writes as a user from
   organization B against organization A's leads/territories/flows.
6. Assignment explanations match stored structured results — verified by
   re-deriving the human-readable explanation from `assignments.explanation`
   and diffing against what was rendered.

These six run in CI on every PR touching `modules/routing`,
`modules/assignments`, or their migrations, not just at milestone
boundaries.

## 3. Playwright (introduced at Milestone 9, per spec)

Critical journeys, run against a preview deployment before any pilot:
1. Admin creates an organization, invites a user, the invited user
   activates their account.
2. Admin creates a team, a territory, a routing flow, publishes it.
3. A lead submitted through the intake API is routed, the assigned agent
   receives a notification, accepts it, and the lead becomes visible in
   their lead list.
4. An assignment is left unanswered past its deadline, expires, and is
   reassigned to the next eligible agent.
5. An unroutable lead lands in manual review and is manually assigned by
   an admin.
6. Cross-tenant check: a second organization's admin cannot see the first
   organization's leads, teams, or routing flows through the UI.

## 4. CI gating

Every PR runs, in order: format check, lint, `tsc --noEmit` (strict mode),
Vitest (unit + integration against a local Supabase stack spun up in CI),
and the Next.js production build. Playwright runs on a schedule / pre-pilot
gate once introduced, not on every PR, to keep CI fast — exact trigger
policy (nightly vs. pre-release tag) decided at Milestone 9.

## 5. What is explicitly not tested in Phase 1

Per the excluded-scope list (spec §6): no tests for calling, SMS,
scheduling, AI routing, or CRM historical-activity import, since none of
that is built. Test coverage tracks the coverage matrix in
`docs/specification-coverage.md` — anything marked "Excluded" there has no
corresponding test obligation.
