# Architecture

Source of truth: `docs/phase1-product-spec.md`. This document describes how
Phase 1 is structured to deliver that spec — it does not introduce new
functionality.

## 1. Product summary

A multi-tenant SaaS platform that sits between lead sources and an external
CRM. It ingests leads (API, webhook, manual, CSV), maps and validates them,
detects duplicates, normalizes location, evaluates versioned routing rules
against team/user eligibility (territory, availability, working hours,
capacity, recipient attributes), creates exactly one active assignment,
drives an accept/decline/expire/reassign lifecycle, explains every decision,
and synchronizes the result to one external CRM and to generic outbound
webhooks. It is explicitly not a full CRM, pipeline, or communications tool.

## 2. Architectural style: modular monolith

A single Next.js application, deployed as one Vercel project, internally
partitioned into modules with hard boundaries. Rationale:

- Phase 1's workload (intake → routing → assignment → notify → sync) is one
  connected transaction pipeline; splitting it into services would spread
  the transaction-safety guarantees in spec §30 across network calls, which
  the spec explicitly forbids ("critical routing logic must not be spread
  across multiple browser requests").
- Supabase already provides the service boundaries that matter (Postgres,
  Auth, Queues, Cron, Edge Functions) — a modular monolith avoids
  reinventing service infrastructure the approved stack already gives us.
- One deployable simplifies GitHub Actions, environment management, and
  Sentry release correlation for a Phase 1 team.

Each module owns its slice of the domain: server-only data access, Zod
schemas, permission checks, and calls into Postgres database functions. UI
composition happens in `app/`, which stays thin — routes and Server Actions
call into modules, never embed business logic.

## 3. Folder structure

```text
src/
  app/                        # Next.js App Router: routes, layouts, Server Actions, route handlers
    (auth)/                   # login, invite acceptance, password reset, email verification
    (app)/                    # dashboard, leads, lead detail, manual review, notifications, profile
    (admin)/                  # org settings, users, teams, territories, routing, integrations, logs
    api/v1/intake/[sourceToken]/route.ts
    api/webhooks/crm/[connectionId]/route.ts
  components/                 # shared, presentation-only UI (no data fetching, no business rules)
  modules/
    auth/                     # session helpers, invitation flow, role/status guards
    organizations/            # org CRUD, settings, data export/deletion
    users/                    # user profiles, roles, deactivation, bulk import
    teams/                    # team CRUD, membership
    recipient-attributes/     # attribute definitions + values
    availability/             # availability status, working hours, capacity, assignment weight
    territories/               # territory CRUD, territory-user/team links, conflict detection
    lead-sources/              # source CRUD, token issuance/rotation, rate-limit + signature config
    lead-intake/                # intake endpoint handling, idempotency, test mode
    field-mapping/              # mapping config, transformations, mapping tester
    custom-variables/           # custom lead variable definitions
    leads/                      # lead CRUD, list/detail/filter queries, statuses
    duplicate-detection/        # duplicate matching + resolution actions
    routing/                    # flows, versions, rules, condition evaluation, simulator
    assignments/                # assignment lifecycle, DB-function callers, exclusion codes
    manual-review/              # manual review queue and resolution actions
    notes/                      # lead notes
    activities/                 # activity timeline writer/reader
    notifications/              # email + in-app notification dispatch
    integrations/                # CRM adapter interface + first adapter, field mapping to CRM
    webhooks/                    # outbound webhook subscriptions, signing, delivery, retries
    routing-health/               # health metrics aggregation + dashboard queries
    audit/                        # audit log writer/reader
    imports/                      # CSV import pipeline (users, territories)
  lib/
    supabase/                  # server/browser client factories, typed client
    validation/                # shared Zod primitives (phone, email, currency, etc.)
    permissions/                # role/scope check helpers used by modules
    logging/                    # structured, PII-safe logging helpers
    sentry/                     # shared beforeSend sanitizer, server/browser init
    errors/                     # typed error classes, safe error response mapping
  types/                        # shared TypeScript types generated from DB schema + domain types

supabase/
  migrations/                   # SQL migrations, timestamp-prefixed, forward-only
  functions/                    # Edge Functions (only where a DB function/Cron/Queue consumer can't do it)
  seed.sql                      # local dev seed data only, never run against linked env

tests/
  unit/                         # colocated with modules where practical, or tests/unit mirroring modules/
  integration/                  # RLS policy tests, routing/assignment transaction tests
  e2e/                           # Playwright specs (added pre-pilot, per testing-strategy.md)

docs/                            # this documentation set
```

## 4. Module → spec mapping

| Module               | Spec sections                                    |
| -------------------- | ------------------------------------------------ |
| auth                 | §10                                              |
| organizations        | §9, §46 (org-level audit), §52 (export/deletion) |
| users                | §8, §10, §14                                     |
| teams                | §11                                              |
| recipient-attributes | §13                                              |
| availability         | §12                                              |
| territories          | §23, §24                                         |
| lead-sources         | §17                                              |
| lead-intake          | §18                                              |
| field-mapping        | §19                                              |
| custom-variables     | §16                                              |
| leads                | §15, §36, §37                                    |
| duplicate-detection  | §21                                              |
| routing              | §25, §26, §27, §28, §29, §34                     |
| assignments          | §30, §31, §32, §33                               |
| manual-review        | §35                                              |
| notes                | §38                                              |
| activities           | §39                                              |
| notifications        | §40                                              |
| integrations         | §42                                              |
| webhooks             | §43                                              |
| routing-health       | §45                                              |
| audit                | §46                                              |
| imports              | §14 (users), §23 (territory import)              |

## 5. Request lifecycle: lead intake to assignment

```text
External source
  -> POST /api/v1/intake/[sourceToken]           (app/api/v1/intake)
  -> lead-intake: authenticate source token, rate limit, idempotency check
  -> field-mapping: map payload to default fields + custom variables
  -> custom-variables / validation (lib/validation, Zod): validate types & rules
  -> duplicate-detection: check idempotency key, external id, email, phone
  -> leads: persist lead row (status=new) + lead_custom_values
  -> territories: normalize location (internal-only columns), match territory
  -> routing.route_lead(lead_id)                  [Postgres function, one transaction]
       - lock routing_state row for the lead
       - confirm no active assignment
       - load published routing_flow_version
       - evaluate routing_rules in priority order (routing module condition engine)
       - build eligible team/user sets, apply exclusion filters (§30 steps 7-14)
       - run assignment algorithm (direct / round robin / weighted round robin)
       - insert assignments row, update leads.assigned_team_id/assigned_user_id
       - update round-robin state atomically
       - insert activities rows
       - enqueue assignment_notifications message (Supabase Queues)
  -> notifications: queue consumer sends email + in-app notification
  -> assignments: agent accepts/declines via Server Action -> accept_assignment /
     decline_assignment Postgres functions
  -> Cron: expire_assignment sweep -> reassign_lead on expiry/decline
  -> integrations: crm_sync queue consumer syncs lead + assignment to CRM
  -> webhooks: outbound_webhooks queue consumer delivers subscribed events
  -> routing-health: metrics updated by Cron aggregation job
```

Everything from "lock routing_state row" through "enqueue assignment_notifications
message" happens inside one Postgres transaction in `route_lead`, so partial
routing states are never visible and never leave more than one active
assignment per lead.

## 6. Why business logic stays server-side

- Server Components and Server Actions are the only place modules are
  imported from; `components/` never talks to Supabase directly.
- All Supabase secret-key usage (service role, used only by Queue/Cron
  consumers and Edge Functions — explicitly not the public intake route,
  which uses a scoped `SECURITY DEFINER` lookup function instead, see
  `docs/decisions.md` ADR-011) lives in `lib/supabase` behind a factory
  that is never imported by client bundles — enforced by ESLint boundary
  rules restricting `lib/supabase/server-only.ts` imports to server files.
- Session/identity resolution uses `@supabase/ssr` client factories and a
  shared `getVerifiedUser()` helper that calls `supabase.auth.getUser()`
  (server-verified) rather than `getSession()` (locally-decoded, not safe
  for authorization) — see `docs/security-model.md` §2 and
  `docs/decisions.md` ADR-010.
- Routing/assignment logic lives in Postgres database functions, not
  application code, so it can never be partially executed by a dropped
  request or a client retry.
