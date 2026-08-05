# API Specification

Source: `docs/phase1-product-spec.md` §18–§20 (intake), §34 (simulator),
§35 (manual review), §42–§43 (integrations/webhooks). All request/response
bodies are validated with Zod schemas colocated in each module
(`modules/<name>/schema.ts`); route handlers and Server Actions only ever
call a parsed, typed payload into module functions.

## 1. Public lead intake API

### `POST /api/v1/intake/[sourceToken]`

The only genuinely public, unauthenticated-by-session endpoint (auth is via
the source token itself). Accepts `application/json` and
`application/x-www-form-urlencoded`.

**Headers**
- `Idempotency-Key` (optional) — deduplicates retried requests from the
  same source within the configurable duplicate window.
- `X-Signature` (optional, required if the source has `signature_settings`
  enabled) — HMAC of the raw body using the source's signing secret.
- `X-Test-Mode: true` (optional) — see Test mode below.

**Body**: free-form JSON object; field names are arbitrary and resolved via
that source's `field_mappings`. See spec §18 for an example payload.

**Processing pipeline** (all inside the lead-intake module, calling into
field-mapping, custom-variables, duplicate-detection, leads, territories,
routing):
1. Resolve `lead_sources` by hashing `sourceToken` and looking up
   `source_token_hash`; 404 if not found or `status = inactive`.
2. Rate-limit check against `rate_limit_settings` (429 on breach).
3. Signature verification if configured (401 on failure).
4. Idempotency/duplicate check (spec §21) — short-circuits with the prior
   result if a match is found within the window.
5. Field mapping + transformation (spec §19).
6. Validation (spec §20) via Zod schemas built dynamically from
   `custom_variable_definitions` + `field_mappings`.
7. On validation failure: write to `submission_logs` with
   `status=failed`, return `422` with structured field errors, do not
   create a lead.
8. On success: persist lead (unless `test_mode`), normalize location,
   call `routing.route_lead` (skipped entirely in test mode — see below),
   write `submission_logs` with `status=validated`.

**Test mode** (`X-Test-Mode: true`): runs steps 1–7 and a read-only routing
preview (identical code path to the simulator, spec §34), but never
persists a `leads`, `assignments`, or `activities` row and never enqueues
notifications/webhooks/CRM sync. Only a `submission_logs` row with
`test_mode = true` is written. This resolves the spec's underspecified
"test mode" semantics — see `docs/decisions.md`.

**Responses**
```
201 Created  { "id": "<submission_log_id>", "status": "received" }
422 Unprocessable Entity  { "errors": [{ "field": "...", "message": "..." }] }
401 Unauthorized          { "error": "invalid_signature" }
404 Not Found             { "error": "unknown_source" }
429 Too Many Requests     { "error": "rate_limited", "retry_after": <seconds> }
```
The response never includes `assigned_user_id`/`assigned_team_id` unless
the lead source's organization has explicitly enabled exposing assignment
in the public response (an opt-in setting, off by default per spec §18).

## 2. Inbound CRM webhook

### `POST /api/webhooks/crm/[connectionId]`
Receives CRM-initiated status changes (spec §42 "receive selected lead
status changes"). Verifies the CRM adapter's signature scheme
(adapter-specific), resolves `integration_connections` by `connectionId`,
and calls `integrations.handle_webhook`. Idempotent via the CRM's own
event id stored in `integration_jobs.dedupe_key`.

## 3. Internal application surface (Server Actions, not public REST)

All other functionality is implemented as Next.js Server Actions colocated
with the page that uses them, calling into the relevant module. They are
not versioned public endpoints; the module function signatures are the
real "API." Representative surface, grouped by module:

| Module | Representative Server Actions |
|---|---|
| organizations | `updateOrganizationSettings`, `exportOrganizationData` |
| users | `inviteUser`, `deactivateUser`, `changeUserRole`, `startBulkUserImport` |
| teams | `createTeam`, `updateTeam`, `setTeamMembership` |
| recipient-attributes | `createRecipientAttribute`, `setUserAttributeValue` |
| availability | `updateAvailabilityStatus`, `updateWorkingHours`, `updateCapacity` |
| territories | `createTerritory`, `updateTerritory`, `importTerritories`, `getTerritoryConflicts` |
| lead-sources | `createLeadSource`, `rotateSourceToken`, `revokeSourceToken` |
| field-mapping | `saveFieldMapping`, `testFieldMapping` (calls the same pipeline as intake, in dry-run) |
| custom-variables | `createCustomVariable`, `updateCustomVariable` |
| leads | `listLeads`, `getLeadDetail`, `updateLeadStatus` |
| duplicate-detection | `resolveDuplicate` |
| routing | `createRoutingFlow`, `updateRoutingRules`, `publishRoutingFlow`, `simulateRouting` |
| assignments | `acceptAssignment`, `declineAssignment`, `manuallyAssignLead`, `manuallyReassignLead` |
| manual-review | `resolveManualReviewItem`, `dismissManualReviewItem`, `rerunRouting` |
| notes | `addNote` |
| integrations | `connectIntegration`, `disconnectIntegration`, `retrySyncJob` |
| webhooks | `createWebhookEndpoint`, `rotateWebhookSecret`, `retryWebhookDelivery` |
| imports | `startImport`, `confirmImport` |

Every Server Action: (1) resolves the caller's session + verified
organization membership server-side, (2) validates input with a Zod
schema, (3) performs a permission check per `docs/permissions-matrix.md`,
(4) calls the module function, which for anything touching routing/
assignment state calls a Postgres database function rather than issuing
raw CRUD SQL.

## 4. Error shape

All API and Server Action errors use one shape (`lib/errors`):
```
{ "error": "<stable_code>", "message": "<safe, non-PII message>", "details"?: [...] }
```
Stable codes are logged and may reach Sentry; `message` and `details` are
scrubbed of personal data before being returned or logged, per
`docs/security-model.md`.
