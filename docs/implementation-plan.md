# Implementation Plan

Source: `docs/phase1-product-spec.md` §55. This is the binding execution
order — work on exactly one milestone at a time (CLAUDE.md rule 2), and do
not start the next until the current milestone's definition of done is
fully met (formatting, linting, type checking, tests, and build all
passing, per CLAUDE.md rule 15).

## Milestone 1 — Foundation
**Build**: Next.js App Router structure, Supabase project wiring, Supabase
Auth, `organizations` + `organization_users`, roles, RLS on all tables that
exist so far, environment variable validation at startup, structured
logging (`lib/logging`), error handling (`lib/errors`), Sentry foundation
(`lib/sentry` sanitizer + client/server/edge config), Vitest harness.
**Definition of done**: users can authenticate; organization membership
works; tenant isolation tests pass; role tests pass; no secret keys
exposed to the browser; Sentry receives a safe test error with PII
stripped.

## Milestone 2 — Users and Teams
**Build**: user invitations + activation, `teams`/`team_users`,
`user_availability`, `user_assignment_settings` (working hours, capacity,
assignment weight), `recipient_attribute_definitions`/`_values`, bulk user
import (`import_jobs`/`import_rows`).
**Definition of done**: admins can configure eligible recipients; agents
can update their own availability; team-scoped permissions work per
`docs/permissions-matrix.md`; imports validate and remain transactional.

## Milestone 3 — Lead Intake
**Build**: `lead_sources` + token issuance/hashing, `POST
/api/v1/intake/[sourceToken]`, idempotency handling, `field_mappings`,
`custom_variable_definitions`, validation pipeline, `submission_logs`,
duplicate detection (`lead_duplicates`), failed-submission recovery
(view/correct/resubmit/ignore).
**Definition of done**: different forms can submit different field names
and land correctly; invalid submissions remain visible and correctable;
duplicate requests don't create duplicate leads; no sensitive values
appear in logs or Sentry.

## Milestone 4 — Territories
**Build**: `lead_locations_internal` + normalization, `territories` (all
seven types incl. PostGIS radius), `territory_users`/`territory_teams`,
postal code / territory import, territory conflict detection (spec §24).
**Definition of done**: every territory type works; internal coordinates
never surface as editable lead fields; conflicts produce the three warning
levels; cross-organization territory access is blocked.

## Milestone 5 — Routing Engine
**Build**: `routing_flows`/`routing_flow_versions`, `routing_rules`/
`routing_rule_versions`, condition evaluator (default fields + custom
variables, all spec §27 operators), recipient-attribute requirements,
eligibility filtering, direct/round-robin/weighted-round-robin algorithms,
fallback logic, the `route_lead` transaction, routing explanations,
`simulate_routing`.
**Definition of done**: published flows route live leads; assignments are
deterministic given identical inputs; the six release-blocking routing
tests in `docs/testing-strategy.md` pass; historical versions are
immutable; every assignment has a structured explanation; simulation
changes zero live rows.

## Milestone 6 — Assignment Accountability
**Build**: assignment notifications (`assignment_notifications` queue),
viewed tracking, `accept_assignment`/`decline_assignment`,
`expire_assignment` + expiration Cron, `reassign_lead` with previous-
recipient exclusion, `manual_review_items`, assignment history display,
the full Queue/Cron wiring from `docs/background-processing.md`.
**Definition of done**: agents can accept/decline; expired assignments are
reassigned automatically; repeated queue/cron runs stay idempotent;
previously-declined recipients are excluded on reassignment; exhausted
leads land in manual review.

## Milestone 7 — Lead Interface
**Build**: dashboard, lead list + filters, lead detail, custom-variable
display, `lead_status_definitions`/`lead_status_history`, `notes`,
`activities` timeline UI, manual review interface, routing health
dashboard (`routing_health_metrics`).
**Definition of done**: agents see only their assigned leads; managers see
only permitted-team leads; admins see all org leads (enforced by RLS, not
just UI filtering); routing/assignment events are visible in the timeline;
the interface stays a lightweight lead view, not a CRM.

## Milestone 8 — Integrations
**Build**: generic CRM adapter interface (`connect`, `disconnect`,
`test_connection`, `list_users`, `create_or_update_contact`,
`assign_owner`, `update_status`, `create_note`, `handle_webhook`,
`refresh_credentials`), the first concrete CRM adapter, CRM field mapping,
owner/status sync, outbound webhooks (`webhook_endpoints`/
`webhook_deliveries`), signed delivery + retry schedule, `integration_logs`,
manual retry UI.
**Definition of done**: leads create/update in the CRM; assigned ownership
syncs; duplicate CRM records are minimized via `external_record_links`;
webhook signatures verify correctly; failed operations retry safely.

## Milestone 9 — Production Readiness
**Complete**: GitHub Actions CI (format/lint/typecheck/test/build on every
PR), Playwright critical journeys (`docs/testing-strategy.md` §3), a
security review, a tenant-isolation review, a concurrency review, Sentry
verification against a production-like environment, a backup review, data
export, data deletion procedures, deployment documentation, incident
response documentation, and a pilot onboarding checklist.
**Definition of done**: all release-blocking tests pass; no unresolved
critical security issue remains; preview deployments work; Sentry receives
production-style errors with no personal information; database migrations
have been reviewed; pilot customers can be onboarded safely.

## Sequencing notes

- Milestones 1–2 are pure prerequisites — nothing after them can be
  meaningfully tested without auth, tenant isolation, and eligible
  recipients existing.
- Milestone 3 (intake) can proceed in parallel conceptually with Milestone
  4 (territories) since they touch different tables, but Milestone 5
  (routing) depends on both, so both must complete first.
- Milestone 6 (accountability) depends on Milestone 5's `assignments`
  table and `route_lead` existing.
- Milestone 7 (UI) can start once Milestones 3–6 exist, since it's mostly
  read-surfaces over what they produced.
- Milestone 8 (integrations) is intentionally last before hardening — it's
  the highest external-dependency risk (one real CRM's API) and benefits
  from a stable domain model underneath it.
- Milestone 9 is a hardening/gate milestone, not new product surface.
