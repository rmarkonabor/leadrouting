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
- CRM credentials (`CRM_CLIENT_SECRET`, per-organization OAuth tokens) are
  stored encrypted using **Supabase Vault** (a Postgres extension backed
  by `pgsodium`), not application-level crypto with a manually-managed
  key — see `docs/decisions.md`. This satisfies spec §52's "encrypted CRM
  credentials" without adding a new provider.
- `WEBHOOK_ENCRYPTION_KEY` similarly protects webhook endpoint secrets at
  rest, or Vault is used uniformly for both — final choice recorded in
  `docs/decisions.md` before Milestone 8.
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

Implemented in Milestone 2 (see `docs/decisions.md` ADR-018 through
ADR-020). `src/lib/sentry/sanitize.ts` exports one `sentryBeforeSend` used
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

## 8. Audit logging (spec §46)

`audit_logs` rows are inserted by module functions immediately after the
audited action's own transaction commits (or in the same transaction where
the action itself is a single write, e.g. role change). No application
role has UPDATE/DELETE grants on `audit_logs`; only INSERT and SELECT
(SELECT gated to `org_admin` per the permissions matrix).

## 9. Known risks and mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service-role key used outside trusted server contexts, bypassing RLS                            | Import-boundary lint rule; code review checklist; only Queue/Cron consumers and Edge Functions may import the service-role client; the public intake endpoint uses a scoped `SECURITY DEFINER` function instead of the service-role client |
| Authorization decision made from an unverified `getSession()` cookie read                       | Shared `getVerifiedUser()` helper wraps `supabase.auth.getUser()`; `getSession()` is banned from authorization code paths by convention and code review                                                                                    |
| Unreviewed destructive migration silently dropping/mutating data in a linked environment        | Destructive schema changes are isolated into their own migration, called out in the PR, and require explicit reviewer sign-off; linked destructive commands require explicit user approval (CLAUDE.md rules 10–12)                         |
| Round-robin race condition producing duplicate/skewed assignments under concurrent submissions  | `SELECT ... FOR UPDATE` on `routing_state` inside `route_lead`; concurrency test is release-blocking (spec §54)                                                                                                                            |
| Two concurrent requests both create an "active" assignment for the same lead                    | Partial unique index on `assignments.lead_id`; lead-routing-record lock in `route_lead`                                                                                                                                                    |
| Webhook/CRM sync replay creating duplicate external records                                     | `external_record_links` unique constraint; `webhook_deliveries` unique constraint; dedupe-key pattern on all queue jobs                                                                                                                    |
| Stale JWT claim granting access after a membership is revoked                                   | RLS policies re-check `organization_users` live, not a cached claim                                                                                                                                                                        |
| PII leaking into Sentry or logs                                                                 | Shared sanitizer/allow-list used by every capture path; no ad hoc `Sentry.captureException` calls without going through the wrapped helper                                                                                                 |
| CRM/webhook secrets stored in plaintext                                                         | Supabase Vault (pgsodium) for credentials at rest; source tokens stored only as hashes                                                                                                                                                     |
| Rate limiting bypassed because no dedicated infra (Redis excluded)                              | DB-backed counters, acceptable at Phase 1 volume; revisit if pilot traffic exceeds single-Postgres-instance comfort                                                                                                                        |
| Cross-organization data exposure via a missing `organization_id` filter in a hand-written query | RLS as backstop even when a module forgets the filter; tenant-isolation tests are release-blocking                                                                                                                                         |
