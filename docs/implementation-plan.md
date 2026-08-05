# Implementation Plan

Source: `docs/phase1-product-spec.md` §55, corrected and expanded during
the architecture/specification-coverage audit. This is the binding
execution order — work on exactly one milestone at a time (CLAUDE.md rule
2), and do not start the next until the current milestone's definition of
done is fully met (formatting, linting, type checking, tests, and build
all passing, per CLAUDE.md rule 15). No feature code is written as part of
this planning document; each milestone below is a scope contract for a
future implementation pass.

---

## Milestone 1 — Foundation

**Status: implemented on `milestone/01-foundation`.** See
`docs/decisions.md` ADR-013–ADR-015 for three deviations from the plan
below, made during implementation: Sentry SDK wiring was deferred (no real
DSN yet, not in the actual kickoff requirements list), organization
creation goes through a `bootstrap_organization()` `SECURITY DEFINER`
function rather than a general "create organization" module action, and
environment validation is forced eagerly via `src/instrumentation.ts`
rather than relying on first-use. `middleware.ts` was written and then
migrated to `src/proxy.ts` per Next.js 16.3's deprecation of the
middleware file convention. RLS/tenant-isolation tests were written
(`tests/integration/rls-tenant-isolation.test.ts`) but could not be run in
the implementation sandbox (no Docker daemon available for `supabase
start`) — see that test file's companion README for how to run them.

**1. Objective**
Stand up the application skeleton, tenant identity model, authentication,
and the tenant-isolation guarantees every later milestone depends on.

**2. Dependencies**
None — first milestone.

**3. Database work**

- Enable RLS on every table created in this milestone from day one (no
  table is ever created without RLS enabled in the same migration).
- `organizations`, `organization_users`, `user_profiles`.
- Base tenant-isolation RLS policy pattern (`docs/security-model.md` §1)
  applied to `organizations`/`organization_users`.
- Shared `updated_at` trigger function used by all future tables.
- `resolve_lead_source` is **not** created yet (no `lead_sources` table
  until Milestone 3) — noted here only so its absence isn't mistaken for
  an oversight.

**4. Server work**

- `lib/supabase`: `@supabase/ssr` browser/server client factories,
  `middleware.ts` session refresh, `getVerifiedUser()` helper wrapping
  `supabase.auth.getUser()` (docs/decisions.md ADR-010).
- `lib/errors`, `lib/logging`, `lib/sentry` (shared `beforeSend` sanitizer,
  client/server/edge Sentry config).
- Environment variable validation at startup (fails fast if a required var
  from `.env.example` is missing/malformed).
- `modules/auth`: session resolution, active-organization resolution from
  verified membership (never from a client-supplied value).
- `modules/organizations`: create organization, update settings.

**5. Interface work**

- Login, invitation-acceptance placeholder, password reset, email
  verification pages (spec §48.1).
- Minimal authenticated shell (nav + sign out) to prove the session flows
  end to end.

**6. Security requirements**

- `SUPABASE_SECRET_KEY` never imported outside a server-only,
  allow-listed directory (ESLint import-boundary rule live from this
  milestone).
- Every authorization check uses `getVerifiedUser()`, never `getSession()`.
- RLS enabled and tested on `organizations`/`organization_users` before
  any other table is added in a later milestone.
- Sentry sanitizer verified against a fixture event containing fake PII.

**7. Tests**
Authentication, Organization isolation, Row Level Security, Role
permissions (spec §54 categories) — plus a Sentry-sanitization unit test
using representative event fixtures.

**8. Manual verification**

- Sign up / verify / log in / log out through the actual UI.
- Attempt (via a direct API/DB client, not the UI) to read another
  organization's `organization_users` row as an authenticated user of a
  different org — confirm it's blocked by RLS, not just hidden by the UI.
- Trigger a deliberate server error and confirm it reaches Sentry with no
  PII fields populated.

**9. Definition of done**
Users can authenticate; organization membership works; tenant isolation
tests pass; role tests pass; no secret keys are exposed to the browser;
Sentry receives a safe test error with PII stripped; format/lint/typecheck/
test/build all pass.

---

## Milestone 2 — Users and Teams

**1. Objective**
Give organizations the recipient model routing will later filter against:
teams, availability, capacity, weights, and recipient attributes.

**2. Dependencies**
Milestone 1 (auth, organizations, RLS pattern, `getVerifiedUser()`).

**3. Database work**

- `teams`, `team_users` (including the `is_manager boolean not null
default false` column — docs/decisions.md ADR-007), `user_availability`,
  `user_assignment_settings`, `recipient_attribute_definitions`,
  `recipient_attribute_values`, `import_jobs`, `import_rows`.
- RLS on all of the above from creation, including the role-scoped
  `is_manager`-based policies on `teams`/`team_users`
  (`docs/security-model.md` §1).
- Constraints: unique `(organization_id, name)` on `teams`, unique
  `(team_id, user_id)` on `team_users`, `assignment_weight > 0`,
  `daily_lead_limit >= 0`, `active_lead_limit >= 0`.

**4. Server work**

- `modules/users`: invitation flow, activation, deactivation, role change.
- `modules/teams`: CRUD, membership management (including toggling
  `is_manager`).
- `modules/availability`: availability status, working hours, capacity,
  assignment weight updates.
- `modules/recipient-attributes`: attribute definitions + per-user values.
- `modules/imports`: CSV upload, column mapping, validation preview,
  transactional confirm, error file generation.

**5. Interface work**

- Users, Teams, Recipient attributes, Bulk user import admin pages (spec
  §48.3).
- Availability settings page for agents (spec §48.2).

**6. Security requirements**

- Every "org" and "team" scoped capability in `docs/permissions-matrix.md`
  for this milestone is enforced by both RLS and a server-side check.
- `team_manager` access verified against `team_users.is_manager = true`,
  not team membership alone.
- Bulk import never partially creates records unless the admin explicitly
  chose partial processing (spec §14) — verified by a test that aborts a
  mixed-validity CSV and checks zero rows were created.

**7. Tests**
User invitations, User deactivation, Team membership, Availability,
Capacity, Custom variables (N/A yet — deferred to M3), Recipient
attributes, Bulk imports.

**8. Manual verification**

- Invite a user, accept the invitation, confirm they land with `agent`
  role and can only see their own profile/availability.
- Promote a user to `team_manager` on Team A only; confirm they cannot see
  Team B's membership or leads (leads don't exist yet, but confirm via the
  Teams admin page and a direct query attempt).
- Run a bulk import with one intentionally invalid row; confirm the
  default transactional mode creates zero rows and surfaces a downloadable
  error file.

**9. Definition of done**
Administrators can configure eligible recipients; agents can update their
own availability; team-scoped permissions work per
`docs/permissions-matrix.md`, verified against the `is_manager` design;
imports validate and remain transactional; all quality gates pass.

---

## Milestone 3 — Lead Intake

**1. Objective**
Accept leads from the outside world safely, map and validate them, and
prevent duplicates — without yet routing them.

**2. Dependencies**
Milestone 1 (auth/org model). Independent of Milestone 2's UI but shares
its RLS conventions.

**3. Database work**

- `lead_sources`, `field_mappings`, `custom_variable_definitions`,
  `leads` (default fields only, per spec §15 — no internal
  location/latitude/longitude columns here), `lead_custom_values`,
  `lead_duplicates`, `submission_logs`, `api_tokens`.
- `resolve_lead_source(token text) returns table (lead_source_id uuid,
organization_id uuid, status text)` as a `SECURITY DEFINER` function
  (docs/decisions.md ADR-011) — the only pre-auth database access point.
- Rate-limit counter table (docs/decisions.md ADR-004 default) keyed by
  `(lead_source_id, time_bucket)`.
- Constraints: global unique `source_token_hash`; unique
  `(lead_source_id, idempotency_key)`; unique `(lead_source_id,
external_submission_id)` where not null; unique `(organization_id,
internal_key)` on `custom_variable_definitions`.

**4. Server work**

- `modules/lead-sources`: source CRUD, token issuance (shown once) and
  rotation, rate-limit/signature settings.
- `modules/lead-intake`: `POST /api/v1/intake/[sourceToken]` — token
  resolution via `resolve_lead_source`, rate limiting, signature
  verification, idempotency check, test-mode branch (docs/decisions.md
  ADR-005).
- `modules/field-mapping`: mapping config CRUD, all twelve transformations
  (spec §19), mapping tester.
- `modules/custom-variables`: definition CRUD, validation-rule evaluation.
- `modules/duplicate-detection`: idempotency key / external id / email /
  phone matching, configurable duplicate actions.
- `modules/leads`: manual lead entry (session-authenticated path, bypasses
  the token-based intake auth entirely).

**5. Interface work**

- Lead sources, Field mappings, Custom lead variables, Submission logs
  admin pages (spec §48.3).
- Mapping tester UI showing original payload, mapped lead, validation
  failures, unmapped fields, duplicate result (routing/assignment
  simulation deferred to Milestone 5 — shows "not yet available" until
  then).

**6. Security requirements**

- The intake route handler never imports the service-role Supabase client
  — verified by the ESLint import-boundary rule from Milestone 1 covering
  this new route.
- `raw_payload`/`mapped_payload` in `submission_logs` never reach Sentry
  or application logs (sanitizer/log-helper test with a fixture payload
  containing fake PII).
- Signature verification uses constant-time comparison.
- Source tokens are never persisted or logged in plaintext after creation.

**7. Tests**
Field mapping, Lead intake, Validation, Duplicate detection — plus a
targeted test asserting `submission_logs.raw_payload` never appears in a
Sentry event or a structured log line.

**8. Manual verification**

- Submit a lead via `curl` with field names that don't match internal
  names; confirm it maps correctly per a configured mapping.
- Resubmit the identical request with the same `Idempotency-Key`; confirm
  no duplicate `leads` row is created.
- Submit with `X-Test-Mode: true`; confirm a `submission_logs` row is
  created with `test_mode = true` and no `leads` row exists.
- Submit an invalid payload; confirm it's visible, correctable, and
  resubmittable from the Submission logs page.

**9. Definition of done**
Different forms can submit different field names and land correctly;
fields map into default fields and custom variables; invalid submissions
remain visible and correctable; duplicate requests don't create duplicate
leads; no sensitive values appear in logs or Sentry; all quality gates
pass.

---

## Milestone 4 — Territories

**1. Objective**
Add the geographic model routing will filter against: normalized internal
location, territories of all seven types, and conflict detection.

**2. Dependencies**
Milestone 3 (`leads` table must exist to attach `lead_locations_internal`
rows to).

**3. Database work**

- Enable the `postgis` extension (docs/decisions.md ADR-002).
- `lead_locations_internal`, `territories` (with `center_geography
geography(Point,4326)` + GIST index), `territory_users`,
  `territory_teams`.
- RLS on all of the above from creation.

**4. Server work**

- `modules/territories`: location normalization call (invoked from the
  intake pipeline as a post-processing step), territory CRUD, user/team
  territory linking, postal-code and territory CSV import (reusing the
  Milestone 2 imports module), radius (`ST_DWithin`) matching, conflict
  detection (spec §24's three severity levels).

**5. Interface work**

- Territories and Territory import admin pages (spec §48.3), including
  conflict warnings surfaced inline (blocking_error/warning/information).

**6. Security requirements**

- Internal coordinates (`internal_latitude`/`internal_longitude`/
  `internal_geography`) are never exposed through any lead-facing API or
  UI field — verified by a test asserting the leads Server Actions'
  response shape excludes these columns entirely.
- Territory RLS confirmed cross-organization-blocked (an org B user cannot
  read org A's territories via direct query).

**7. Tests**
Territory matching (all seven types, incl. PostGIS radius with fixture
coordinates).

**8. Manual verification**

- Create one territory of each type; submit a lead whose normalized
  location should match each in turn; confirm the match (via the
  conflict-detection/diagnostics view, since routing itself isn't built
  yet — this is a territory-matching-only check).
- Create two overlapping active territories; confirm a `warning` surfaces.
- Attempt to read another organization's territory via a direct
  authenticated query as an org B user; confirm RLS blocks it.

**9. Definition of done**
Every territory type works; internal coordinates never surface as
editable lead fields; conflicts produce the three warning levels;
cross-organization territory access is blocked; all quality gates pass.

---

## Milestone 5 — Routing Engine

**1. Objective**
Build the deterministic, transaction-safe routing and assignment core —
the highest-risk, most safety-critical part of the product.

**2. Dependencies**
Milestones 2 (recipients/eligibility inputs), 3 (leads), and 4
(territories) must all be complete — routing filters against all three.

**3. Database work**

- `routing_flows`, `routing_flow_versions` (immutable-after-publish
  trigger), `routing_rules`, `routing_rule_versions`, `routing_state`,
  `assignments` (with the partial unique index on `lead_id` for
  non-terminal statuses), `assignment_attempts`, `manual_review_items`,
  `activities` (insert-only).
- Database functions: `route_lead`, `accept_assignment`,
  `decline_assignment`, `expire_assignment`, `reassign_lead`,
  `simulate_routing` (docs/routing-engine.md §5).
- Cross-org FK guard triggers where a bare FK can't express same-org
  membership (e.g. `assignments.user_id` must belong to `assignments`'
  own `organization_id`).

**4. Server work**

- `modules/routing`: condition evaluator (all spec §27 operators),
  eligibility filter pipeline (spec §30 steps 7–14, exclusion codes from
  spec §33), direct/round-robin/weighted-round-robin/fallback algorithms,
  flow/rule CRUD and publish flow, `simulateRouting` Server Action calling
  `simulate_routing`.
- `modules/assignments`: `acceptAssignment`/`declineAssignment` Server
  Actions calling the DB functions, assignment history queries.
- `modules/manual-review`: queue read model over `manual_review_items`.

**5. Interface work**

- Routing flows, Routing rules, Routing simulator admin pages (spec
  §48.3) — simulator UI surfaces the full explanation structure (spec
  §34).

**6. Security requirements**

- `simulate_routing` verified to write zero rows to `leads`,
  `assignments`, `activities`, `routing_state`, `manual_review_items` —
  enforced by a test, not just code review.
- `route_lead`/`reassign_lead` locking verified under concurrency (see
  tests below) so no RLS bypass or race condition can create two active
  assignments.
- Routing explanations contain no personal lead data beyond what's already
  visible to the viewer through normal lead RLS.

**7. Tests**
Routing rule matching, Direct assignment, Round robin, Weighted round
robin, Assignment concurrency — plus all six release-blocking routing
tests from `docs/testing-strategy.md` §2 (concurrent-submission dedup,
round-robin rotation integrity under concurrency, historical version
immutability, simulation zero-side-effect, cross-org routing data
isolation, explanation-matches-stored-result).

**8. Manual verification**

- Publish a flow with a round-robin team action; fire 20 concurrent test
  leads at it (a script, not manual clicking) and confirm the assignment
  distribution matches expected rotation with no duplicates/skips.
- Publish v1 of a flow, route a lead, publish v2 with different rules,
  confirm the already-routed lead's stored `routing_flow_version_id` still
  reflects v1's rules.
- Run the simulator against a real lead payload and confirm the database
  is unchanged (row counts identical before/after across the tables
  listed in requirement 6 above).

**9. Definition of done**
Published flows route live leads; assignments are deterministic given
identical inputs; the six release-blocking routing tests pass; historical
versions are immutable; every assignment has a structured explanation;
simulation changes zero live rows; all quality gates pass.

---

## Milestone 6 — Assignment Accountability

**1. Objective**
Close the loop on an assignment's lifecycle: notify, track viewed,
accept/decline, expire, reassign, and fall through to manual review when
recipients are exhausted.

**2. Dependencies**
Milestone 5 (`assignments`, `route_lead`, `reassign_lead` must exist).

**3. Database work**

- `notifications`, `integration_jobs` (used generically as the
  dedupe-keyed job/queue record from `docs/background-processing.md`).
- Any additional columns needed on `assignments` for `notified_at`/
  `viewed_at` if not already present from Milestone 5 (reconcile against
  the Milestone 5 schema rather than duplicating).

**4. Server work**

- `modules/notifications`: `assignment_notifications` queue consumer
  (email + in-app), `operational_alerts` consumer.
- Supabase Queues wiring for `assignment_notifications`.
- Supabase Cron jobs: `expire-assignments`, `send-expiration-warnings`
  (docs/background-processing.md §2).
- Viewed-tracking endpoint/Server Action fired when an agent opens an
  assignment notification link.

**5. Interface work**

- In-app notifications list/read state (spec §48.2).
- Assignment accept/decline actions surfaced on the lead detail page
  (full lead detail UI itself is Milestone 7 — this milestone only needs
  the accept/decline affordance, not the full page).
- Manual review queue interface (spec §48.3) — list/filter/resolve.

**6. Security requirements**

- `accept_assignment`/`decline_assignment` verified idempotent under
  repeated calls (double-click, retried request).
- Notification queue consumer confirmed not to roll back or block a
  committed assignment transaction on failure (spec §40).
- Expired-assignment restoration is an explicit admin-only action, not
  reachable by the original assignee.

**7. Tests**
Assignment acceptance, Assignment decline, Assignment expiration,
Automatic reassignment, Manual review, Queue idempotency, Cron
idempotency.

**8. Manual verification**

- Accept an assignment twice in a row (simulating a double-click); confirm
  no error and no duplicate state change.
- Let an assignment's deadline pass; confirm it expires and reassigns to
  the next eligible agent, excluding the original.
- Exhaust all eligible agents for a lead (decline through all of them);
  confirm it lands in manual review with the correct reason code.
- Run the expiration Cron job twice back-to-back; confirm the second run
  is a no-op (no double reassignment).

**9. Definition of done**
Agents can accept and decline; expired assignments are reassigned
automatically; repeated queue/cron runs stay idempotent; previously
declined recipients are excluded on reassignment; exhausted leads land in
manual review; all quality gates pass.

---

## Milestone 7 — Lead Interface

**1. Objective**
Give every role the lightweight lead-visibility surface the spec calls
for, without becoming a CRM.

**2. Dependencies**
Milestones 3–6 (leads, routing, assignments, manual review all populate
the data this milestone displays).

**3. Database work**

- `lead_status_definitions` (seeded per-org with the nine default
  statuses), `lead_status_history`, `notes`.
- Confirm/extend RLS on `leads`/`activities`/`notes`/`manual_review_items`
  to the finalized role-scoped policies from `docs/security-model.md` §1
  (they were designed in Milestone 5 for `assignments`/`leads` — this
  milestone is where they get full UI-level exercise).

**4. Server work**

- `modules/leads`: `listLeads` (with all spec §36.2 filters),
  `getLeadDetail`, `updateLeadStatus`.
- `modules/notes`: `addNote`.
- `modules/activities`: read helpers for timeline rendering (write path
  already exists from Milestone 5/6).
- `modules/routing-health`: `getRoutingHealth` query layer over
  `routing_health_metrics` (table populated starting this milestone by a
  new Cron job, `refresh-routing-health-metrics`).

**5. Interface work**

- Dashboard, Lead list, Lead detail, Manual review interface (full page,
  building on Milestone 6's queue actions), Routing health dashboard (spec
  §48.2/§48.3).

**6. Security requirements**

- End-to-end verification (not just unit-level) that an agent's lead list
  contains only their assigned leads, a team manager's only their managed
  teams' leads, and an admin's the full organization — using real
  authenticated sessions against seeded multi-role fixture data.
- Original raw payload view gated to `org_admin` only (spec §36.3 item 14).

**7. Tests**
(Primarily exercises RLS/permission tests already written in earlier
milestones against the new UI surface) plus new coverage for lead status
transitions, notes visibility, and routing-health metric accuracy.

**8. Manual verification**

- Log in as an agent, a team manager, and an org admin (three separate
  sessions/fixture users) against the same seeded organization; confirm
  each sees exactly the leads `docs/permissions-matrix.md` says they
  should.
- Confirm the lead detail page's activity timeline shows every event type
  generated by Milestones 3–6 for a lead that's been through the full
  intake → route → decline → reassign → accept flow.

**9. Definition of done**
Agents see only their assigned leads; managers see only permitted-team
leads; admins see all org leads (enforced by RLS, not just UI filtering);
routing/assignment events are visible in the timeline; the interface stays
a lightweight lead view, not a CRM; all quality gates pass.

---

## Milestone 8 — Integrations

**1. Objective**
Synchronize routed leads and their ownership to one external CRM and to
generic outbound webhook subscribers.

**2. Dependencies**
Milestone 7 (a stable lead/status/note/activity model to synchronize) and
Milestone 6 (assignment events to react to).

**3. Database work**

- `integration_connections`, `integration_field_mappings`,
  `external_record_links`, `integration_logs`, `webhook_endpoints`,
  `webhook_deliveries`.
- Confirm Supabase Vault availability (docs/decisions.md ADR-003) before
  writing the credential-storage migration; fall back to `pgcrypto` +
  `WEBHOOK_ENCRYPTION_KEY` if Vault isn't available on the target plan,
  updating ADR-003's status either way.

**4. Server work**

- `modules/integrations`: generic CRM adapter interface (`connect`,
  `disconnect`, `test_connection`, `list_users`,
  `create_or_update_contact`, `assign_owner`, `update_status`,
  `create_note`, `handle_webhook`, `refresh_credentials`) and one concrete
  adapter implementation; `crm_sync` and `integration_retries` queue
  consumers.
- `modules/webhooks`: endpoint CRUD, secret rotation, signed delivery,
  `outbound_webhooks` queue consumer, retry schedule (1m/5m/30m/2h/12h).
- Cron jobs: `drain-crm-sync-retries`, `drain-webhook-retries`,
  `dead-letter-sweep`.

**5. Interface work**

- CRM integration, Outbound webhooks, Integration logs admin pages (spec
  §48.3), including manual retry actions.

**6. Security requirements**

- CRM credentials and webhook secrets encrypted at rest per the finalized
  ADR-003 mechanism; never logged or sent to Sentry.
- `integration_logs.request_summary`/`response_summary` verified
  pre-redacted (no credentials, tokens, or raw lead PII) before insert.
- Webhook deliveries signed and replay-protected (`event_id` uniqueness).
- `external_record_links` uniqueness verified to prevent duplicate CRM
  contact creation under retry.

**7. Tests**
Webhook signatures, Webhook retries, CRM retries — plus a duplicate-CRM-
record regression test that retries a `crm_sync` job multiple times and
asserts only one `external_record_links` row exists.

**8. Manual verification**

- Connect the CRM adapter against a sandbox/test account; route a lead;
  confirm a contact is created/updated and ownership is assigned.
- Force a CRM API failure (e.g. point at an invalid endpoint temporarily);
  confirm the job retries on schedule and appears in Integration logs,
  then manually retry it successfully once the failure is cleared.
- Register a webhook endpoint (e.g. a request-bin style test URL); trigger
  a `lead.assigned` event; verify the signature on the received payload.

**9. Definition of done**
Leads create/update in the CRM; assigned ownership syncs; duplicate CRM
records are minimized; webhook signatures verify correctly; failed
operations retry safely; all quality gates pass.

---

## Milestone 9 — Production Readiness

**1. Objective**
Harden, verify, and document the system for real pilot traffic — no new
product surface, only gating work.

**2. Dependencies**
Milestones 1–8 complete.

**3. Database work**

- Review every migration written so far for the reversibility policy in
  `docs/database-schema.md` §21a; confirm no destructive migration lacks
  the required reviewer sign-off trail.
- Confirm Supabase automatic backups are enabled and note the retention
  window in the production readiness doc.

**4. Server work**

- GitHub Actions CI pipeline: format, lint, `tsc --noEmit`, Vitest (unit +
  integration against a local Supabase stack spun up in CI), Next.js
  build, dependency vulnerability scan (spec §52 item 18).
- Data export and data deletion procedures finalized and documented (spec
  §52 items 20–21) — data deletion is an operational runbook executed with
  explicit approval, not a self-service UI action in Phase 1.

**5. Interface work**

- None new — this milestone verifies existing interface work end to end.

**6. Security requirements**

- Full security review against every item in `docs/security-model.md` §9
  (known risks table), including the corrections made in this audit
  (RLS role-scoping, `getUser()`-only authorization, intake's
  `SECURITY DEFINER` lookup, migration reversibility policy).
- Tenant isolation review: re-run every cross-organization test in the
  suite against the complete, integrated system, not just per-module.
- Concurrency review: re-run the six release-blocking routing tests under
  higher parallelism than Milestone 5's original test run.
- Confirm separate development/preview/production environments and env
  var sets are actually configured in Vercel + Supabase, not just
  documented (spec §52 item 17).

**7. Tests**
Sentry sanitization (full pass against production-shaped events), Audit
logs — plus the full existing suite run once more end to end, and
Playwright critical journeys introduced for the first time
(`docs/testing-strategy.md` §3).

**8. Manual verification**

- Walk all six Playwright critical journeys manually once against a
  preview deployment before automating them, to catch anything the script
  wouldn't.
- Confirm a production-style error reaches Sentry with zero personal
  fields populated, using real (not fixture) production configuration.
- Confirm a Vercel Preview deployment builds and serves correctly for a
  branch, and that production deployment is gated behind explicit
  approval per CLAUDE.md rule 13 (do not actually deploy to production as
  part of this milestone's verification unless the user explicitly
  approves it).

**9. Definition of done**
All release-blocking tests pass; no unresolved critical security issue
remains; preview deployments work; Sentry receives production-style
errors with no personal information; database migrations have been
reviewed against the reversibility policy; pilot customers can be
onboarded safely; all quality gates pass.

---

## Sequencing notes

- Milestones 1–2 are pure prerequisites — nothing after them can be
  meaningfully tested without auth, tenant isolation, and eligible
  recipients existing.
- Milestone 3 (intake) and Milestone 4 (territories) touch disjoint tables
  and could be developed in either order, but both must complete before
  Milestone 5 (routing), which depends on both.
- Milestone 6 (accountability) depends on Milestone 5's `assignments`
  table and `route_lead`/`reassign_lead` existing.
- Milestone 7 (UI) depends on Milestones 3–6 since it's a read/act surface
  over what they produce.
- Milestone 8 (integrations) is intentionally last before hardening — it
  carries the highest external-dependency risk (one real CRM's API) and
  benefits from a stable domain model underneath it.
- Milestone 9 is a hardening/gate milestone, not new product surface, and
  is where this audit's corrections get their final end-to-end
  verification pass.
