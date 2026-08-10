# Security Model

Source: `docs/phase1-product-spec.md` §9–§10, §17–§18, §42–§44, §47, §52.

## 1. Tenant isolation

**Principle**: never trust a client-supplied `organization_id`. The active
organization is resolved server-side as:

```
authenticated user (Supabase Auth session)
  -> requested organization context (e.g. /org/[orgSlug]/... route param, a hint only)
  -> verified row in organization_users matching (user_id, organization_id) with status = 'active'
  -> that verified organization_id is what's used for every subsequent query this request
```

If the route param doesn't match any active membership, the request is
rejected (403) before touching any tenant data — the route param is never
passed straight into a query filter.

**RLS policy pattern** used on every tenant table (illustrative, actual
DDL lives in migrations):

```sql
create policy tenant_isolation_select on <table>
  for select
  using (
    exists (
      select 1 from organization_users ou
      where ou.organization_id = <table>.organization_id
        and ou.user_id = auth.uid()
        and ou.status = 'active'
    )
  );
```

This deliberately queries `organization_users` live on every check rather
than trusting a JWT custom claim baked in at login. A claim-based approach
would let a removed/deactivated member retain access until their token
expires or refreshes; the live-membership check closes that window. The
cost is an extra join per query, judged acceptable for Phase 1 volumes and
mitigated by the `organization_id` index on every tenant table (see
`docs/database-schema.md` §21).

Role-scoped policies layer an additional predicate on top of the
tenant-isolation clause above. Concrete examples (illustrative; actual DDL
lives in migrations):

```sql
-- leads: org_admin sees all org leads; team_manager sees leads assigned to
-- teams they manage; agent sees only leads assigned to them.
create policy leads_role_scoped_select on leads
  for select
  using (
    exists (
      select 1 from organization_users ou
      where ou.organization_id = leads.organization_id
        and ou.user_id = auth.uid()
        and ou.status = 'active'
        and (
          ou.role = 'org_admin'
          or (
            ou.role = 'team_manager'
            and exists (
              select 1 from team_users tu
              where tu.team_id = leads.assigned_team_id
                and tu.user_id = auth.uid()
                and tu.is_manager = true
            )
          )
          or (ou.role = 'agent' and leads.assigned_user_id = auth.uid())
        )
    )
  );

-- assignments: an agent may only accept/decline their own assignment.
create policy assignments_agent_self on assignments
  for select
  using (
    user_id = auth.uid()
    or exists ( /* org_admin / permitted team_manager clause, same shape as above */ 1 )
  );
```

The same `tu.is_manager = true` predicate (backed by the `team_users`
column added in `docs/database-schema.md`) is reused on `teams`,
`manual_review_items`, and `routing_health_metrics` policies so a
`team_manager` can never read or act on a team they don't manage, and an
`agent` can never read another agent's lead or assignment row. This
directly satisfies audit requirements 5–7 (agents isolated from other
agents' leads, managers isolated to managed teams, admins isolated to
their own organization).

**Defense in depth**: every module function additionally takes the
server-resolved `organization_id` as an explicit parameter and includes it
in its query, so a hypothetical RLS misconfiguration is not the only line
of defense. Server-side authorization checks (role/scope per
`docs/permissions-matrix.md`) run before RLS is ever reached.

## 2. Authentication

Supabase Auth handles credentials, sessions, verification, and reset
(spec §10). `organization_users.status` (`invited/active/inactive/
suspended`) is checked in both middleware (redirect anyone not `active` in
their resolved org away from protected routes) and in RLS policies (an
`inactive`/`suspended` member's rows are invisible even if middleware were
somehow bypassed). Automatic assignment eligibility (spec §12) also checks
this status inside `route_lead`, independent of the UI-layer check.

**Client library**: the current `@supabase/ssr` package is the only
supported way to wire Supabase Auth into the Next.js App Router — the
deprecated `@supabase/auth-helpers-nextjs` package is not used. Three
client factories in `lib/supabase`:

- `createBrowserClient` (from `@supabase/ssr`) for Client Components.
- `createServerClient` (from `@supabase/ssr`), reading/writing cookies via
  `next/headers`, for Server Components, Server Actions, and Route
  Handlers.
- Root `middleware.ts` calls `createServerClient` with a request/response
  cookie adapter and refreshes the session on every matched request, per
  the standard `@supabase/ssr` middleware pattern, so cookies stay valid
  across Server Component renders.

**`getUser()`, never `getSession()`, for authorization**: `getSession()`
reads the session out of the cookie and decodes the JWT locally — it does
**not** contact the Supabase Auth server, so a tampered or stale cookie can
pass a `getSession()` check. Every server-side authorization decision
(resolving the active organization, checking role/scope before a module
function runs, RLS aside) calls `supabase.auth.getUser()`, which revalidates
the token against the Supabase Auth server on each call. `getSession()` may
only be used for non-authoritative purposes (e.g. an optimistic client-side
"am I logged in" check for UI state) and is never the basis for a
permission decision. This is enforced by a single shared
`getVerifiedUser()` helper in `lib/supabase` that every module's
authorization entry point calls — no module calls `getSession()` directly
for auth purposes. See `docs/decisions.md` ADR-010.

## 3. Secrets

- `SUPABASE_SECRET_KEY` (service role) is used only in server-only modules
  invoked from Queue/Cron consumers and Edge Functions — never imported by
  any file reachable from a client bundle, and **not** by the public
  intake route handler. An ESLint import-boundary rule enforces this at
  build time (fails CI if `lib/supabase/service-role.ts` is imported
  outside an allow-listed server-only directory list, which explicitly
  excludes `app/api/v1/intake`). The intake handler's one pre-auth need —
  resolving a `lead_sources` row by token — is served by the narrow
  `SECURITY DEFINER` function `resolve_lead_source` (see
  `docs/database-schema.md` §6 and ADR-011) called via RPC with the normal
  `anon`/publishable-key client, so the service-role key never appears on
  the request path with the largest untrusted-input surface (a public,
  unauthenticated-by-session endpoint).
- CRM credentials (per-organization OAuth access/refresh tokens) and
  webhook endpoint secrets are encrypted at rest with application-level
  AES-256-GCM (`lib/crypto/secret-box.ts`), keyed by the server-only
  `WEBHOOK_ENCRYPTION_KEY` env var — not Supabase Vault. Vault (pgsodium)
  was the originally planned mechanism (see the now-superseded ADR-003) but
  was never implemented; ADR-051 records the actual decision and its
  rationale. Encryption and decryption happen entirely in Node
  (`encryptSecret`/`decryptSecret`); Postgres only ever stores and returns
  the resulting opaque ciphertext (`credentials_encrypted`/
  `secret_encrypted` columns, typed `text`), never touching the plaintext.
  This satisfies spec §52's "encrypted CRM credentials" without adding a
  new provider or dependency.
- Source tokens (spec §17) are stored only as a hash
  (`lead_sources.source_token_hash`); the plaintext token is shown once at
  creation/rotation and never persisted.

## 4. Lead intake security

- **Rate limiting**: DB-backed (Postgres counter table keyed by source +
  time bucket) rather than Redis, per the approved stack — see
  `docs/decisions.md`.
- **Signature verification**: HMAC-SHA256 over the raw request body using
  the source's per-source signing secret when `signature_settings` is
  enabled; constant-time comparison.
- **Idempotency**: `Idempotency-Key` header plus `external_submission_id`
  both feed duplicate detection (spec §21); neither alone is trusted as
  sufficient for security purposes (they're correctness/dedup tools, not
  auth), so intake auth is always the source token, independent of them.

## 5. Webhook (outbound) security

- Every delivery is signed (HMAC over the JSON payload, secret rotatable
  per spec §43).
- Replay protection: each event carries a unique `event_id`; the
  `webhook_deliveries` unique constraint on `(webhook_endpoint_id,
event_id)` prevents us from recording/re-emitting the same logical event
  twice, and documented receiver guidance recommends the same dedupe on
  the customer's side.
- Retry schedule (1m/5m/30m/2h/12h) and manual retry are logged, never
  silently dropped, per `docs/background-processing.md`.

## 6. Inbound CRM webhook security

Verified per-adapter (each CRM's own signature/secret scheme, implemented
inside that adapter, not the generic interface) before `handle_webhook` is
invoked.

## 7. Sentry sanitization (spec §47)

Implemented in Milestone 2 (see `docs/decisions.md` ADR-024 through
ADR-026). `src/lib/sentry/sanitize.ts` exports one `sentryBeforeSend` used
identically by `src/instrumentation-client.ts` (browser) and
`src/instrumentation.ts` (Node and Edge runtimes — the current,
Turbopack-compatible init locations; there is no separate
`sentry.server.config.ts`/`sentry.edge.config.ts`). It:

- Sets `sendDefaultPii: false` and never adds a Replay integration (Session
  Replay stays disabled for Phase 1).
- Strips: `event.user` entirely, `request.cookies`, `request.data` (the
  request body — where original lead payloads/form messages/custom
  variable values would appear), any request header matching
  `/authorization|cookie|token|secret|api[-_]?key/i`, `event.extra`
  entirely, and any `event.contexts`/breadcrumb data not on a small
  allow-list of Sentry's own technical context names.
- Keeps only the allow-listed tag keys in
  `src/lib/sentry/allowed-tags.ts` (`organization_id`, `lead_id`,
  `assignment_id`, `routing_flow_id`, `routing_flow_version_id`,
  `source_id`, `job_id`, `integration_provider`) — everything else in
  `event.tags` is dropped. `environment`/`release` are Sentry's own
  top-level event fields, not custom tags, and are unaffected.
- Regex-scrubs exception/breadcrumb message text for secret-shaped
  substrings (Bearer tokens, JWT-shaped strings covering Supabase
  secret/access/refresh tokens, vendor API-key prefixes) as defense in
  depth — the primary control is still never embedding a secret in a
  thrown error message in the first place.
- Drops (returns `null` for) events whose original exception is a
  `ZodError` or an `AppError` with code `invalid_input` — spec §47's
  "expected validation errors must not be reported as Sentry exceptions."
  Every other error, including `AppError("internal_error")`, is still
  reported.
- Applies identically everywhere because Server Components, Route
  Handlers, and Server Actions all report through one shared path: Next's
  official `onRequestError` hook (`export const onRequestError =
Sentry.captureRequestError` in `src/instrumentation.ts`), not per-route
  manual wrapping.

Application code attaches diagnostic identifiers only through
`setSentryDiagnosticContext()` (`src/lib/sentry/diagnostics.ts`), which is
typed to accept only the allow-listed keys — the sanitizer re-enforces the
same allow-list at runtime as a backstop.

The same allow-list discipline applies to `lib/logging` — application logs
never include lead PII, matching CLAUDE.md rule 18.

### 7.1 Milestone 9 re-verification against post-M6–M8 event shapes

`tests/unit/sentry-sanitize.test.ts`'s "Milestone 9 production-shaped event
review" suite builds events matching the payload shapes that only became
possible after Milestones 6–8 and confirms the same allow-list-based
sanitizer (unchanged since Milestone 2) still strips them correctly, since
it operates structurally (drop `request.data`/`extra`/breadcrumb `data`
wholesale, allow-list tags/contexts) rather than by naming specific
payload shapes:

- A CRM contact sync payload (name/email/phone/custom variables) carried as
  breadcrumb `data` — stripped.
- A webhook delivery's outgoing event payload (`request.data`) — stripped.
  Its HMAC signature header (`x-webhook-signature`) is intentionally left
  alone: it is a public digest of the payload, not a bearer credential, and
  the payload it signs is already gone.
- CRM credentials (`accessToken`/`refreshToken`) attached via
  `extra`/`contexts` — stripped, since both channels are dropped/allow-
  listed wholesale regardless of key names inside them.
- A rendered notification email body (subject/HTML containing a lead's name
  and email) carried as breadcrumb `data` — stripped.
- Milestone 8's new tag keys: `job_id`/`integration_provider` pass through
  (allow-listed); `connection_id`/`webhook_endpoint_id`/`delivery_id` are
  dropped (not on the allow-list, and not needed — `job_id` already
  correlates back to the `integration_jobs` row for support/debugging).

One accepted, documented limitation surfaced by this review: the
regex-based secret-scrubbing fallback in `sanitize.ts` (Bearer tokens,
JWT-shaped strings, Stripe/Square-style key prefixes) does **not** match
an arbitrary vendor-shaped CRM token embedded directly in an exception
message (e.g. `at_live_...`). This is explicitly the defense-in-depth
layer, not the primary control — the primary control is
`src/modules/integrations/redact.ts`'s `buildSafeRequestSummary`/
`buildSafeResponseSummary`, which structurally never carries a field
_value_ (only field names, method, and a query-string-stripped URL) into
any log or error path in the first place, so no code path in
`http-crm-adapter.ts` ever interpolates a credential into a thrown `Error`
message for the regex layer to need to catch. Verified by a test that
documents this current behavior explicitly rather than silently assuming
the regex layer is exhaustive.

## 8. Audit logging (spec §46)

`audit_logs` rows are inserted by module functions immediately after the
audited action's own transaction commits (or in the same transaction where
the action itself is a single write, e.g. role change). No application
role has UPDATE/DELETE grants on `audit_logs`; only INSERT and SELECT
(SELECT gated to `org_admin` per the permissions matrix).

## 9. Known risks and mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service-role key used outside trusted server contexts, bypassing RLS                            | Import-boundary lint rule; code review checklist; only Queue/Cron consumers and Edge Functions may import the service-role client; the public intake endpoint uses a scoped `SECURITY DEFINER` function instead of the service-role client                                                                                                                                                  |
| Authorization decision made from an unverified `getSession()` cookie read                       | Shared `getVerifiedUser()` helper wraps `supabase.auth.getUser()`; `getSession()` is banned from authorization code paths by convention and code review                                                                                                                                                                                                                                     |
| Unreviewed destructive migration silently dropping/mutating data in a linked environment        | Destructive schema changes are isolated into their own migration, called out in the PR, and require explicit reviewer sign-off; linked destructive commands require explicit user approval (CLAUDE.md rules 10–12)                                                                                                                                                                          |
| Round-robin race condition producing duplicate/skewed assignments under concurrent submissions  | `SELECT ... FOR UPDATE` on `routing_state` inside `route_lead`; concurrency test is release-blocking (spec §54)                                                                                                                                                                                                                                                                             |
| Two concurrent requests both create an "active" assignment for the same lead                    | Partial unique index on `assignments.lead_id`; lead-routing-record lock in `route_lead`                                                                                                                                                                                                                                                                                                     |
| Webhook/CRM sync replay creating duplicate external records                                     | `external_record_links` unique constraint; `webhook_deliveries` unique constraint; dedupe-key pattern on all queue jobs                                                                                                                                                                                                                                                                     |
| Stale JWT claim granting access after a membership is revoked                                   | RLS policies re-check `organization_users` live, not a cached claim                                                                                                                                                                                                                                                                                                                         |
| PII leaking into Sentry or logs                                                                 | Shared sanitizer/allow-list used by every capture path; no ad hoc `Sentry.captureException` calls without going through the wrapped helper                                                                                                                                                                                                                                                  |
| CRM/webhook secrets stored in plaintext                                                         | Application-level AES-256-GCM encryption (`lib/crypto/secret-box.ts`, keyed by `WEBHOOK_ENCRYPTION_KEY`) for credentials at rest, per ADR-051 — supersedes the originally-planned Supabase Vault (pgsodium) approach, which was never implemented; source tokens stored only as hashes                                                                                                      |
| Rate limiting bypassed because no dedicated infra (Redis excluded)                              | DB-backed counters, acceptable at Phase 1 volume; revisit if pilot traffic exceeds single-Postgres-instance comfort                                                                                                                                                                                                                                                                         |
| Cross-organization data exposure via a missing `organization_id` filter in a hand-written query | RLS as backstop even when a module forgets the filter; tenant-isolation tests are release-blocking                                                                                                                                                                                                                                                                                          |
| Data loss with no way to recover (accidental deletion, bad migration, provider incident)        | Known, accepted gap on the current Supabase free-tier project: automatic backups / point-in-time recovery are not available on the free plan. No workaround is implemented in Phase 1 — documented honestly in `docs/production-readiness.md` rather than papered over; upgrading the Supabase project tier is the only real mitigation, and is a business decision, not an engineering one |

### 9.1 Milestone 9 re-verification

Every mitigation above was re-checked against the system as it exists after
Milestones 6–8 (notifications, lead interface, integrations/webhooks), not
just as originally designed:

- Service-role import boundary: still enforced by the `eslint.config.mjs`
  allow-list, which now also covers `src/modules/integrations/**` and
  `src/modules/webhooks/**`; the inbound CRM webhook route
  (`src/app/api/webhooks/crm/[connectionId]/route.ts`) was deliberately
  written against the `anon` client plus two narrow `SECURITY DEFINER`
  functions rather than the service-role client, mirroring the lead-intake
  pattern this mitigation describes.
- `getVerifiedUser()` remains the only path into
  `requireOrgAdminContext`/`requireOrgContext`; no module added since M5
  reads `getSession()` for an authorization decision.
- Round-robin locking and the single-active-assignment partial unique index
  are untouched by M6–M8 (no migration in this window alters
  `routing_state` or `assignments`).
- Webhook/CRM replay dedupe: confirmed by Milestone 8's own regression test
  ("duplicate-CRM-record regression: retrying the same sync_contact job
  never creates a second external_record_links row",
  `tests/unit/integrations/process-crm-sync.test.ts`) and by
  `webhook_deliveries`'s unique constraint plus signature/replay checks in
  `modules/webhooks/signing.ts`.
- PII-in-Sentry: re-verified in full as its own Milestone 9 task against
  every new event shape (notification, CRM sync, webhook delivery) —
  tracked separately, not duplicated here.
- Cross-org exposure: re-verified as its own Milestone 9 task running the
  complete `tests/integration` suite together against one shared database
  with all 8 migrations applied, rather than per-milestone in isolation.
