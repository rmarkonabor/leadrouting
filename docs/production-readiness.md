# Production Readiness Audit

Performed immediately before any live customer data enters the
application, per explicit instruction. Scope: audit only — no new product
features. This document is the single source of truth for go/no-go
status; it does not soften or omit findings to look more finished than
the system actually is.

**Verdict: NOT YET READY for live customer data.** Two release-blocking
issues were found and fixed in code during this audit (a real cross-tenant
authorization gap, and a missing-privileges bug that would break the app
for every real user); both fix migrations have now been applied to the
linked Supabase project, per user confirmation. Two items remain open:
database backups (a business decision, not something engineering can fix)
and confirmation that dev/preview/production Supabase projects are
actually separate. See §31 for the complete blocker list.

## How to read this document

Each of the 30 requested checks below is classified:

- **Release blocking** — must not have live customer data until resolved.
- **High priority** — must be resolved before pilot, not before a
  from-scratch build restart.
- **Medium priority** — should be resolved before pilot; not a hard gate.
- **Low priority** — cosmetic/documentation-only gaps.
- **Verified — no issue** — checked and found sound.

## 1. Phase 1 specification coverage

**Verified — no issue**, with **Low priority** cleanup applied.
`docs/specification-coverage.md` traces every Phase 1 scope item (spec
§5), acceptance criterion (§56), and excluded item (§6) to its module,
table, action, and test. Three rows describing Milestone 9 deliverables
were stale ("Planned" for work that is now actually done) — corrected as
part of this audit. Two rows were downgraded from "Planned" to "Needs
Clarification" because they describe things this session could not
independently verify (see §21, §29) rather than things that are simply
unbuilt. No item from the spec's "Explicitly Excluded Scope" list
(calling, SMS, scheduling, marketing automation, a full CRM, a visual
pipeline, AI routing/qualification/summaries, lead auctions,
multi-workspace orgs) has been built — confirmed by re-reading that
section against the actual module list in `src/modules/`.

## 2. Tenant isolation

**Verified — no issue**, except see §4's release-blocking finding, which
is a tenant-isolation issue in substance (cross-org data exposure via
manual assignment) even though it's filed under "server authorization"
below since that's its root cause. Every tenant table carries
`organization_id`; `organization_id` is never trusted from the client
(resolved server-side via `getCurrentOrganization`); the full
`tests/integration` suite (66 tests across 9 files, after this audit's
additions) passes together against one shared, fully-migrated database,
confirming no later migration regressed an earlier one's isolation
guarantees (`tests/integration/README.md`).

## 3. Row Level Security

**Verified — no issue.** Every one of the 44 tables created across all 13
migrations has `enable row level security` — confirmed by diffing the
full list of `create table public.*` statements against the full list of
`alter table ... enable row level security` statements; the sets match
exactly, zero tables missing RLS.

## 4. Server authorization

**RELEASE BLOCKING — found and fixed.** `manually_assign_or_reassign_lead`
(backing both `manually_assign_lead` and `manually_reassign_lead`) checked
that the _caller_ was an `org_admin` or permitted `team_manager`, but
never checked that the _target_ `user_id` (or optional `team_id`) actually
belonged to the lead's own organization. An org_admin of organization A
could submit any UUID — a real user or team from organization B, or a
value matching nothing — and the function would still create the
assignment and fire a notification targeting it. RLS protects the lead's
own row from being read back by the foreign user, but the notification
itself (title/body describing the lead) is a direct write, not something
RLS gates. See `docs/decisions.md` ADR-058 for full detail.

**Fix**: `supabase/migrations/20260813100000_validate_manual_assignment_org_membership.sql`
adds explicit membership/ownership checks before any mutation. Three new
tests (`tests/integration/milestone6-assignment-lifecycle.test.ts`
11a/11b/11c) confirm the fix — each one **fails against the pre-fix
function** and **passes with the fix applied**, proving the tests exercise
real behavior. Full suite: 66/66 passing with the fix in place.

**This migration has been applied to the linked Supabase project**
(confirmed by the user). See §31 for the remaining blockers.

Every other server-authorization path was re-checked and found sound:
`requireOrgContext`/`requireOrgAdminContext` resolve the organization from
verified membership, never a client-supplied value; `getVerifiedUser()`
(never `getSession()`) is the only path into authorization decisions
(`docs/decisions.md` ADR-010); the routing engine's own candidate
selection (`route_lead`) derives eligible users from scoped
`organization_users`/`team_users` queries, not free-text input, so it
isn't vulnerable to the same class of bug as the manual-assignment path.

## 5. Secret handling

**Verified — no issue.** `SUPABASE_SECRET_KEY` is referenced only in
`src/lib/env/server.ts` and `src/lib/supabase/service-role.ts`; every
other file that imports the service-role client is on the ESLint
`no-restricted-imports` allow-list (`eslint.config.mjs`) — checked every
file matching `service-role`/`service_role`/`createServiceRoleClient` in
`src/` and confirmed each match reachable from the allow-listed directory
list, or was a comment (not an actual import). No job in
`.github/workflows/ci.yml` contains a real secret — every env var there is
a hardcoded, non-sensitive placeholder (`docs/branch-protection.md`
confirms this and documents the `${{ secrets.NAME }}` pattern for any
future real one).

## 6. Supabase publishable key usage

**Verified — no issue.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the
only Supabase key ever bundled to the browser (CLAUDE.md rule 5); it is
safe to expose by design (RLS is the real gate on what it can read/write).

## 7. Supabase secret key isolation

**Verified — no issue.** Same finding as §5/§6: `SUPABASE_SECRET_KEY`
never crosses into a client-reachable file, enforced by the ESLint
import-boundary rule as a build-time check, not just a convention.

## 8. Routing transactions

**Verified — no issue** (after the fix already delivered in the
concurrency review). `route_lead`, `accept_assignment`,
`decline_assignment`, `expire_assignment`, and `reassign_lead` are each
single-transaction `SECURITY DEFINER` Postgres functions (CLAUDE.md rule 21) — never a multi-request client-orchestrated flow. `route_lead` locks
the `leads` row first (`SELECT ... FOR UPDATE`) to serialize concurrent
calls for the same lead, and locks `routing_state` narrowly (only at the
moment a round-robin pick is made) per `docs/decisions.md` ADR-038.

## 9. Assignment uniqueness

**Verified — no issue.** A partial unique index,
`assignments_one_active_per_lead_idx on assignments(lead_id) where status
in ('pending','notified','viewed')`, is the actual database-level
guarantee — not just application-level convention. `route_lead`'s insert
is wrapped in `exception when unique_violation`, re-selecting and
returning the assignment the other concurrent transaction actually
created rather than erroring.

## 10. Round robin concurrency

**RELEASE BLOCKING — found and fixed** (in an earlier phase of this same
production-readiness effort, re-verified here). `compute_routing_decision`
took no lock on the very first assignment ever made for a team+flow,
because `SELECT ... FOR UPDATE` against a query matching zero rows locks
nothing — multiple concurrent `route_lead` calls landing on that
"no row yet" state could all pick the same first candidate. See
`docs/decisions.md` ADR-056.
**Fix** (already delivered, already merged into this branch's history):
`supabase/migrations/20260813080000_milestone9_routing_state_race_fix.sql`
inserts a zeroed row (`on conflict do nothing`) immediately before the
lock, so the lock always has a real row to serialize on, including for
the very first assignment.
**Re-verified this audit**: `tests/integration/milestone9-concurrency.test.ts`
(60 genuinely concurrent leads → exact 12/12/12/12/12 split; 25 concurrent
calls on one lead → exactly one `assigned`; 20 concurrent
`simulate_routing` calls racing 10 real `route_lead` calls → simulated
lead never assigned, cursor advances by exactly 10) — 3/3 passing.

## 11. Queue idempotency

**Verified — no issue.** `integration_jobs` has a unique constraint on
`(queue_name, dedupe_key)` — the producer-side dedupe guarantee. The
notification consumer additionally uses `JobStatusChecker` as a
consumer-side redelivery guard (`docs/decisions.md` ADR-043): a redelivered
message whose side effects already completed is acked without reprocessing.
`tests/unit/notifications/process-assignment-notifications.test.ts` and
`tests/unit/integrations/process-crm-sync.test.ts` both include an explicit
redelivery-idempotency test.

## 12. Cron idempotency

**Verified — no issue.** `run_expire_assignments` re-running on an
already-expired assignment is a no-op (covered in
`tests/integration/milestone6-assignment-lifecycle.test.ts`, scenario 8/9);
the drain-retry Cron jobs (`drain_integration_retries`) operate on the
same `integration_jobs` ledger with `next_retry_at`/`attempt_count`
guards, so a re-run before the retry window elapses picks up nothing.

## 13. Webhook signatures

**Verified — no issue.** `modules/webhooks/signing.ts` computes an
HMAC-SHA256 signature over the exact outgoing payload; delivery includes
the signature header; `tests/unit/webhooks/signing.test.ts` verifies
tamper-detection (a modified payload fails verification even with the
correct secret) and that different secrets produce non-matching
signatures.

## 14. Replay protection

**Verified — no issue.** `webhook_deliveries` has a unique constraint on
`(webhook_endpoint_id, event_id)` for idempotent, replay-safe delivery.
Inbound CRM webhooks use `timingSafeEqual` for signature comparison
(`http-crm-adapter.ts`) to avoid timing side-channels, and every dedupe
key across the integration system follows the same `(queue_name,
dedupe_key)`-shaped pattern.

## 15. CRM duplicate prevention

**Verified — no issue.** `external_record_links` has a unique constraint
on `(provider, organization_id, external_record_id)`. The "duplicate-CRM-
record regression" test (`tests/unit/integrations/process-crm-sync.test.ts`)
retries the same `sync_contact` job three times and confirms exactly one
`external_record_links` row and one CRM contact are ever created — the
second/third attempts PATCH the existing record rather than creating a
new one.

## 16. Personal information in logs

**Verified — no issue.** `src/modules/integrations/redact.ts` builds
`request_summary`/`response_summary` structurally safe: only method, a
query-string-stripped URL, and field _names_ (never values) are ever
recorded. No application code path logs a raw request or lead payload
outside this pattern (grepped for direct `console.log`/logger calls
against lead/request objects — none found).

## 17. Personal information in Sentry

**Verified — no issue**, with **one documented, accepted limitation**.
`src/lib/sentry/sanitize.ts`'s `sentryBeforeSend` strips `event.user`,
`request.cookies`, `request.data`, `event.extra`, and any
`event.contexts`/breadcrumb data outside a small allow-list of Sentry's
own technical context names, and allow-lists `event.tags` to
`SENTRY_ALLOWED_TAG_KEYS` (`organization_id`, `lead_id`, `assignment_id`,
`routing_flow_id`, `routing_flow_version_id`, `source_id`, `job_id`,
`integration_provider`) — everything else in tags is dropped. Re-verified
this audit against Milestone 6-8 event shapes (CRM sync payloads, webhook
deliveries, notification emails) — all stripped correctly
(`tests/unit/sentry-sanitize.test.ts`, "Milestone 9 production-shaped
event review"). **Documented limitation** (Low priority, not blocking):
the regex-based secret-scrubbing fallback for exception _messages_ doesn't
match an arbitrary vendor-shaped credential (e.g. `at_live_...`) — this is
explicitly the defense-in-depth layer, not the primary control; the
primary control (`redact.ts`, above) never puts a credential value into a
message in the first place, verified by code inspection of
`http-crm-adapter.ts`.

## 18. Source map configuration

**MEDIUM PRIORITY — found and fixed.** `next.config.ts`'s Sentry plugin
config uploaded source maps but never explicitly deleted them from the
build output afterward. Next's own default
(`productionBrowserSourceMaps` unset/false) already prevents Next itself
from serving them publicly, so this was not an active exposure, but
relying on that alone left generated `.map` files sitting in build output
where a future config change or build-artifact leak could expose them.
**Fix**: added `sourcemaps: { deleteSourcemapsAfterUpload: true }` —
verified with a full `npm run build`, which still succeeds.

## 19. Error alerts

**MEDIUM PRIORITY — cannot be verified or configured from this session.**
Sentry alert rules (e.g. "notify on new issue," "notify on error-rate
spike") are configured in the Sentry project dashboard, not in this
codebase — there is nothing in `next.config.ts`/`instrumentation.ts` that
could enforce them, and this session has no access to the Sentry
dashboard to check or set them. **Action needed from the user**: confirm
at least one alert rule exists in the Sentry project (e.g. "email/Slack on
every new issue") before pilot traffic — otherwise a production error
could go unnoticed until a customer reports it.

## 20. Database migrations

**RELEASE BLOCKING — found and fixed.** No migration across Milestones
1-9 ever granted table-level privileges to the `authenticated`/
`service_role` Postgres roles — every table's access relied entirely on
RLS, but Postgres checks the table-level `GRANT` _before_ RLS is ever
evaluated. `supabase/config.toml`'s own `auto_expose_new_tables` setting
confirms new tables are not auto-exposed by default anymore ("the new
cloud default") — a behavior Supabase used to provide automatically. This
surfaced only once real CI ran `supabase start` + the integration suite
for the first time; every prior local sandbox verification had these
grants applied by hand, outside any migration file. See
`docs/decisions.md` ADR-057.
**Fix**: `supabase/migrations/20260813090000_grant_table_privileges_to_data_api_roles.sql`
grants the missing privileges and sets default privileges for future
tables. Verified against a from-scratch Postgres instance with zero manual
workaround grants: the full 63-test (now 66-test, after this audit's
additions) suite passes.
**Status on the linked project**: per the user, this migration has
already been applied. **Action needed**: confirm with a real authenticated
request (e.g. load the dashboard) that this actually resolved cleanly.

Migration reversibility itself remains sound: every migration across all
13 files is additive-only (`docs/database-schema.md` §22.1/second
addendum) — the two release-blocking fixes in this audit are both
`CREATE OR REPLACE FUNCTION`/`GRANT` statements, never a destructive
schema change.

## 21. Backup plan

**RELEASE BLOCKING — cannot be fixed by engineering work.** The linked
Supabase project is on the free tier, which has no automatic backups or
point-in-time recovery. This was confirmed directly by the user, not
assumed. There is no code-level workaround — building one would itself be
out-of-scope, unapproved product surface. See `docs/backup-and-restore.md`
for exactly what this means operationally and what upgrading would look
like. **This is a business decision (upgrade the Supabase project tier,
or explicitly accept the risk of zero recovery), not something resolved
by this or any future engineering pass.**

## 22. Data export

**Verified — no issue.** `docs/data-export-and-deletion-runbook.md` §2
documents the operational procedure: verify the requester, export every
tenant table scoped by `organization_id` via `\copy`, package and deliver
securely, record the export in `audit_logs`. Deliberately not a
self-service UI action in Phase 1, per spec's own scope for this
milestone.

## 23. Data deletion

**Verified — no issue.** Same runbook, §3: every tenant table cascades
from `organizations` via `organization_id ... on delete cascade`
(verified against the full table list), so a single `delete from
organizations where id = ...` removes exactly one organization's data and
nothing else. Requires explicit approval and an export-first step by
policy, not a UI action.

## 24. Rate limiting

**Verified — no issue.** `check_and_increment_intake_rate_limit` is a
DB-backed counter function, called from `process-submission.ts` with a
per-source configurable window/max-requests, wired into the live intake
path (`POST /api/v1/intake/[sourceToken]`) — confirmed by tracing the
actual call site, not just the function's existence.

## 25. Input validation

**Verified — no issue.** Zod schemas validate input across the modules
that need static, well-known shapes (17 of 27 modules import `zod`
directly). The remaining modules either have no meaningful user input
(read-only list/display modules — `activities`, `dashboard`,
`routing-health`, etc.) or validate through a purpose-built mechanism more
appropriate than a static schema: lead intake's field values are
org-configured and dynamic, so `validateLeadFields`
(`modules/lead-intake/validate-lead-fields.ts`) validates each field
against its own field-mapping's `required`/type rules rather than one
fixed Zod object — confirmed this is real, working validation (required
fields, email/phone format, max length), not a gap.

## 26. Audit logs

**Verified — no issue.** `audit_logs` is insert-and-select only — no
migration grants or RLS policy allows `UPDATE`/`DELETE` on it (confirmed
by re-reading its RLS policies: only `audit_logs_insert_self_action` and
`audit_logs_select_org_admin` exist). `logAuditEvent` is called from every
mutating module action for the events spec §46 requires.

## 27. Dependency vulnerabilities

**Verified — no issue.** `npm audit --audit-level=high` reports 0
vulnerabilities as of this audit, and runs on every PR
(`.github/workflows/ci.yml`).

## 28. Vercel environment separation

**Partially verified — Medium priority, needs manual confirmation.**
Verified directly against the real `leadrouting` Vercel project's
deployment history via the Vercel API: every push to a `milestone/*`/
feature branch produces its own Preview deployment; every
`target: "production"` deployment in the project's history originates
from `main`, with no exception. **Not verifiable from this session**:
whether environment variables are actually scoped differently per
environment (Development/Preview/Production checkboxes on each variable
in the Vercel dashboard) — there is no tool available here to list a
project's environment variables. **Action needed from the user**: confirm
in the Vercel dashboard that env vars are genuinely scoped per
environment, not all set to the same values.

## 29. Development, preview, and production separation

**HIGH PRIORITY — cannot be verified from this session.** Whether a
genuinely separate Supabase project (not just a separate schema, and
definitely not the same project) backs local/preview development versus
the production project could not be checked — this session has no
Supabase account access, only the linked project's connection details
supplied for migration application. If preview deployments and real pilot
data currently share one Supabase project, that is a serious risk (a
developer's preview testing could touch, or a bug in preview could
corrupt, real customer data). **Action needed from the user**: confirm
this explicitly, or set it up before pilot traffic if it isn't already
separate.

## 30. Playwright coverage for critical flows

**Verified as automated — Medium priority, not yet run live.** All six
critical journeys from `docs/testing-strategy.md` §3b are automated in
`tests/e2e/` (`org-invite-activate.spec.ts`,
`team-territory-routing-publish.spec.ts`, `intake-to-accept.spec.ts`,
`expiration-reassignment.spec.ts`, `manual-review-assignment.spec.ts`,
`cross-tenant-isolation.spec.ts`) — confirmed via `npx playwright test
--list`, which shows all 17 tests (6 new + the Milestone 7 slice)
registering correctly. **They have not been run against a real deployed
app** — this sandbox has no live Supabase project or running app instance
to point them at. **Action needed from the user**: run `npm run test:e2e`
against a real preview deployment (see `tests/e2e/README.md` for required
env vars) before pilot traffic, and/or walk the six journeys by hand once,
per the Milestone 9 plan's own manual-verification step.

## 31. Complete list of remaining release blockers

1. ~~Apply `20260813100000_validate_manual_assignment_org_membership.sql`
   to the linked Supabase project (§4)~~ — **resolved.** The user confirmed
   this migration has been applied to the linked project.
2. ~~Confirm `20260813090000_grant_table_privileges_to_data_api_roles.sql`
   actually resolved cleanly~~ (§20) — the user reports it was applied.
   Still worth a real authenticated smoke test (load the dashboard, view a
   lead) before pilot traffic, but no longer blocking on its own.
3. **Database backups (§21)** — no automatic backups on the current
   Supabase free-tier project. Requires a business decision (upgrade tier
   or explicitly accept zero recovery) before real customer data enters
   the system. This cannot be closed by any engineering fix.
4. **Confirm dev/preview/production Supabase project separation (§29)** —
   could not be verified from this session; if not actually separate, this
   is also effectively release blocking (preview activity could touch real
   data).

Items 1 and 2 are resolved. **Items 3 and 4 remain open** — do not point
real customer data at this system until both are resolved or explicitly,
knowingly accepted by the person responsible for that decision.

## 32. High/Medium/Low priority items (non-blocking, should still be resolved before pilot)

- **High**: dev/preview/production Supabase separation confirmation (§29,
  also listed as a blocker above since its answer could make it one).
- **Medium**: confirm Sentry alert rules exist (§19); confirm Vercel env
  vars are actually scoped per environment (§28); run the Playwright
  critical journeys against a real deployment (§30).
- **Low**: the Sentry regex-fallback limitation for arbitrary vendor
  credential shapes (§17) — accepted, primary control already covers it.

## See also

- `docs/deployment-runbook.md` — exact manual deployment steps.
- `docs/incident-response.md` — what to do when something goes wrong in
  production.
- `docs/backup-and-restore.md` — the backups gap in full detail, and what
  restore would look like if backups existed.
- `docs/pilot-checklist.md` — the condensed go/no-go checklist derived
  from this audit.
- `docs/data-export-and-deletion-runbook.md` — organization data export
  and deletion procedures (spec §52 items 20-21).
- `docs/branch-protection.md` — required GitHub branch protection
  settings (not yet applied by a repo admin).
