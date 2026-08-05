# Database Schema

Source of truth for functionality: `docs/phase1-product-spec.md` §11, §13,
§15–§17, §19, §23, §25–§26, §30–§31, §37–§39, §41, §43–§44, §46, §50–§51.
This document turns the spec's table list and field lists into a concrete
schema plan. Actual DDL is written as SQL migrations in Milestone 1+, not
here.

All tables below are tenant-owned unless marked **global**. Every
tenant-owned table has `organization_id uuid not null references
organizations(id)` and an RLS policy (see `docs/security-model.md` for the
policy pattern). Every table has `created_at timestamptz not null default
now()`; tables that are mutated also have `updated_at timestamptz not null
default now()` maintained by a shared trigger.

## 1. Organizations & membership

### `organizations` (root tenant table)
`id, name, slug, status (active|suspended), settings jsonb, created_at, updated_at`

### `organization_users`
Membership + role, one row per (organization, user).
`id, organization_id, user_id (references auth.users), role
(org_admin|team_manager|agent), status (invited|active|inactive|suspended),
invited_by_user_id, invited_at, activated_at, created_at, updated_at`
Constraint: unique (`organization_id`, `user_id`).

### `user_profiles`
One row per Supabase Auth user, **not** tenant-owned (a person can belong to
multiple organizations).
`id (= auth.users.id), full_name, avatar_url, default_organization_id,
created_at, updated_at`

## 2. Teams

### `teams`
Per spec §11: `id, organization_id, name, description, status
(active|inactive), default_assignment_method
(direct|round_robin|weighted_round_robin), default_acceptance_deadline_minutes,
default_fallback_user_id, timezone, operating_hours jsonb, created_at, updated_at`
Constraint: unique (`organization_id`, `name`).

### `team_users`
`id, organization_id, team_id, user_id, is_manager boolean not null default
false, created_at`
Constraint: unique (`team_id`, `user_id`). `is_manager = true` is what makes
a team "permitted" for a `team_manager`-role user — see
`docs/permissions-matrix.md` and `docs/decisions.md` ADR-007 (finalized).
An `is_manager` row is only meaningful when the user's
`organization_users.role = team_manager`; an `org_admin`'s access is never
gated by this flag.

## 3. Availability & capacity

### `user_availability`
`id, organization_id, user_id, availability_status
(available|busy|away|vacation|offline), status_note, updated_by_user_id,
created_at, updated_at`

### `user_assignment_settings`
Per spec §12: `id, organization_id, user_id, accept_leads boolean,
timezone, working_hours jsonb, daily_lead_limit int, active_lead_limit int,
assignment_weight int, created_at, updated_at`
Constraints: `assignment_weight > 0`, `daily_lead_limit >= 0`,
`active_lead_limit >= 0`.

## 4. Recipient attributes

### `recipient_attribute_definitions`
Per spec §13: `id, organization_id, name, internal_key, description,
field_type (text|long_text|number|currency|boolean|date|datetime|
single_select|multi_select|email|phone|url), required boolean,
default_value jsonb, options jsonb, validation_rules jsonb, active boolean,
created_at, updated_at`
Constraint: unique (`organization_id`, `internal_key`).

### `recipient_attribute_values`
`id, organization_id, user_id, attribute_definition_id, value jsonb,
created_at, updated_at`
Constraint: unique (`user_id`, `attribute_definition_id`).

## 5. Territories

### `territories`
Per spec §23: `id, organization_id, name, territory_type
(country|state_province|county|city|neighborhood|postal_code|radius),
country, state_province, county, city, neighborhood, postal_code,
center_geography geography(Point,4326), radius_distance numeric,
priority int, status (active|inactive), effective_start_date,
effective_end_date, created_at, updated_at`
`center_geography`/`radius_distance` populated only for `territory_type =
'radius'` (PostGIS extension `postgis` enabled once, in Milestone 4).

### `territory_users`
`id, organization_id, territory_id, user_id, created_at`

### `territory_teams`
`id, organization_id, territory_id, team_id, created_at`

## 6. Lead sources & field mapping

### `lead_sources`
Per spec §17: `id, organization_id, name, source_type
(api|webhook|external_form|manual|csv|crm), status (active|inactive),
source_token_hash, default_routing_flow_id, rate_limit_settings jsonb,
signature_settings jsonb, created_at, updated_at`
Constraint: unique `source_token_hash` **global** (tokens must be globally
unique to route an inbound request to the right org before org context
exists).

**Pre-auth lookup**: the intake route handler (`POST
/api/v1/intake/[sourceToken]`) has no user session and therefore no RLS
context, but must resolve `lead_sources` by token before any org context
exists. This does **not** use the Supabase service-role client. Instead a
`SECURITY DEFINER` Postgres function, `resolve_lead_source(token text)
returns table (lead_source_id uuid, organization_id uuid, status text)`,
hashes the input and looks up exactly one row, callable by the `anon`
Postgres role via RPC. This keeps the intake path privilege-scoped to one
narrow, audited function instead of granting the route handler broad
service-role access — see `docs/security-model.md` §3 and
`docs/decisions.md` ADR-011.

### `field_mappings`
Per spec §19, one row per mapped field per source:
`id, organization_id, lead_source_id, source_field_name, destination_type
(default_field|custom_variable|ignored), destination_field, data_type,
required boolean, default_value jsonb, transformation
(trim|lowercase|uppercase|normalize_email|normalize_phone|parse_number|
parse_currency|to_boolean|split_full_name|join_values|replace_values|
apply_default), validation_rule jsonb, created_at, updated_at`

### `custom_variable_definitions`
Per spec §16: same shape as `recipient_attribute_definitions` but for
leads: `id, organization_id, name, internal_key, description, field_type,
required, default_value jsonb, options jsonb, validation_rules jsonb,
active, created_at, updated_at`
Constraint: unique (`organization_id`, `internal_key`).
Unknown-variable handling (`reject_unknown_variables|
ignore_unknown_variables|store_for_review`, default `store_for_review`) is
an organization-level setting stored on `organizations.settings`.

## 7. Leads

### `leads`
Per spec §15 (identity, location, source, consent, system fields):
```
id, organization_id,
first_name, last_name, full_name, email, phone,
street_address, unit_number, neighborhood, city, county, state_province,
postal_code, country,
lead_source_id, external_submission_id, message, campaign, medium,
referrer, landing_page,
email_consent, sms_consent, privacy_consent, consent_text,
consent_timestamp, consent_ip,
assigned_team_id, assigned_user_id, lead_status, assignment_status,
priority, duplicate_status,
created_at, updated_at
```
No `latitude`/`longitude`/`location_confidence`/`product_type`/etc. columns
here per spec §15 — those are internal-only (see `lead_locations_internal`)
or organization-defined custom variables.
Constraint: unique (`lead_source_id`, `external_submission_id`) where
`external_submission_id is not null`.

### `lead_custom_values`
`id, organization_id, lead_id, variable_definition_id, value jsonb,
created_at, updated_at`
Constraint: unique (`lead_id`, `variable_definition_id`).

### `lead_locations_internal`
Per spec §22, never exposed as an editable lead field:
`id, organization_id, lead_id, normalized_address, internal_latitude,
internal_longitude, internal_geography geography(Point,4326),
geographic_identifier, normalization_status
(confirmed|partial|ambiguous|invalid|not_provided), normalization_provider,
normalization_metadata jsonb, created_at, updated_at`

### `lead_duplicates`
Per spec §21: `id, organization_id, lead_id, duplicate_of_lead_id,
match_basis (idempotency_key|external_submission_id|email|phone|
external_crm_record_id), action_taken
(flag_and_continue|send_to_manual_review|update_existing|
reject_submission), created_at`

## 8. Lead statuses

### `lead_status_definitions`
Per spec §37: `id, organization_id, key, label, sort_order, is_default_set
boolean, active boolean, created_at, updated_at`. Seeded per-org with
`new, assigned, accepted, contact_attempted, contacted, qualified,
unqualified, converted, lost`; organizations can rename/reorder/disable/add.

### `lead_status_history`
`id, organization_id, lead_id, from_status, to_status, changed_by_user_id,
created_at`

## 9. Routing

### `routing_flows`
Per spec §25: `id, organization_id, name, description, status
(draft|active|inactive|archived), default_team_id, default_user_id,
acceptance_deadline_minutes, created_at, updated_at, published_at`

### `routing_flow_versions`
Immutable once created (enforced by trigger rejecting UPDATE after
`published_at` is set): `id, organization_id, routing_flow_id, version_number,
published_at, published_by_user_id, created_at`

### `routing_rules`
Working/draft copy, editable pre-publish: `id, organization_id,
routing_flow_id, name, priority, match_type (match_all|match_any),
conditions jsonb, recipient_requirements jsonb, action jsonb,
stop_processing boolean, created_at, updated_at`

### `routing_rule_versions`
Per spec §26, a frozen snapshot of `routing_rules` rows captured at publish
time, linked to `routing_flow_version_id`: same columns as `routing_rules`
minus mutability, plus `routing_flow_version_id`. Never updated after
insert.

### `routing_state`
One row per team (round robin cursor) used by `route_lead`'s atomic
rotation update: `id, organization_id, team_id, routing_flow_id,
last_assigned_user_id, rotation_cursor int, updated_at`
Constraint: unique (`organization_id`, `team_id`, `routing_flow_id`).

## 10. Assignments

### `assignments`
Per spec §30–§33: `id, organization_id, lead_id, routing_flow_id,
routing_flow_version_id, team_id, user_id, status
(pending|notified|viewed|accepted|declined|expired|reassigned|cancelled),
assignment_algorithm (direct|round_robin|weighted_round_robin|fallback|
manual), acceptance_deadline_at, notified_at, viewed_at, responded_at,
explanation jsonb, created_at, updated_at`
Constraint: **partial unique index** on `lead_id` where `status in
('pending','notified','viewed')` — enforces spec §30's "at most one active
assignment per lead."

### `assignment_attempts`
Full history including exclusions, one row per attempt (superset of
`assignments`, since `assignments` holds only real created assignments;
`assignment_attempts` also records attempts where no user was ultimately
eligible): `id, organization_id, lead_id, assignment_id (nullable),
routing_rule_id, eligible_team_ids jsonb, eligible_user_ids jsonb,
excluded jsonb ([{user_id, reason_code}]), selected_user_id, outcome
(assigned|no_eligible_user|manual_review), created_at`

## 11. Manual review

### `manual_review_items`
Per spec §35: `id, organization_id, lead_id, reason
(no_matching_rule|no_eligible_user|missing_required_data|missing_location|
ambiguous_location|invalid_location|duplicate_review|
all_users_at_capacity|all_users_unavailable|assignment_attempts_exhausted|
manual_request|submission_mapping_error), status (open|resolved|dismissed),
resolved_by_user_id, resolved_at, created_at, updated_at`

## 12. Notes & activity

### `notes`
Per spec §38: `id, organization_id, lead_id, author_user_id, content,
created_at, updated_at`

### `activities`
Per spec §39, append-only (no UPDATE grant): `id, organization_id, lead_id,
activity_type (enum matching the 27 types in spec §39), actor_user_id
(nullable for system events), metadata jsonb, created_at`

## 13. Notifications

### `notifications`
`id, organization_id, user_id, event_type, lead_id, assignment_id, title,
body, read_at, created_at`

## 14. Submissions & imports

### `submission_logs`
Per spec §20: `id, organization_id, lead_source_id, raw_payload jsonb,
mapped_payload jsonb, validation_errors jsonb, status
(received|validated|failed|resubmitted|ignored), idempotency_key,
external_submission_id, test_mode boolean, resulting_lead_id, created_at,
updated_at`
`raw_payload` may contain personal data — access restricted to org admins,
excluded from Sentry entirely (see security-model.md).

### `import_jobs`
`id, organization_id, import_type (users|territories), status
(pending|validating|ready|importing|completed|failed), file_reference,
column_mapping jsonb, summary jsonb, allow_partial boolean,
created_by_user_id, created_at, updated_at`

### `import_rows`
`id, organization_id, import_job_id, row_number, raw_data jsonb,
status (valid|invalid|imported|skipped), errors jsonb, created_at`

## 15. Integrations

### `integration_connections`
Per spec §42: `id, organization_id, provider, status
(connected|disconnected|error), credentials_encrypted bytea (via Supabase
Vault, see decisions.md), settings jsonb, connected_by_user_id,
connected_at, created_at, updated_at`

### `integration_field_mappings`
`id, organization_id, integration_connection_id, source_field, crm_field,
transformation, created_at, updated_at`

### `external_record_links`
Per spec §51 constraint 7: `id, organization_id, integration_connection_id,
lead_id, provider, external_record_id, created_at, updated_at`
Constraint: unique (`provider`, `organization_id`, `external_record_id`).

### `integration_jobs`
Queue-backed job record (also see background-processing.md):
`id, organization_id, queue_name, job_type, payload jsonb, status
(queued|processing|completed|failed|retrying|cancelled|dead_letter),
attempt_count, next_retry_at, dedupe_key, created_at, updated_at`
Constraint: unique (`queue_name`, `dedupe_key`).

### `integration_logs`
Per spec §44: `id, organization_id, provider, event_type, lead_id,
request_summary jsonb, response_summary jsonb, status, attempt_count,
next_retry_at, created_at, completed_at`
`request_summary`/`response_summary` must be pre-redacted before insert —
no credentials, tokens, or raw personal lead data (enforced at the
application layer that writes these rows, per spec §44).

## 16. Webhooks

### `webhook_endpoints`
`id, organization_id, url, secret_encrypted bytea, subscribed_events
text[], status (active|inactive), created_at, updated_at`

### `webhook_deliveries`
Per spec §43: `id, organization_id, webhook_endpoint_id, event_id (uuid,
unique per delivery for replay protection), event_type, payload jsonb,
status (queued|processing|delivered|failed|retrying|dead_letter),
attempt_count, next_retry_at, last_response_status, created_at,
completed_at`
Constraint: unique (`webhook_endpoint_id`, `event_id`) for idempotent
delivery/replay protection.

## 17. Audit

### `audit_logs`
Per spec §46, insert-only (no UPDATE/DELETE grant to any application
role): `id, organization_id, actor_user_id, action, entity_type, entity_id,
before_data jsonb, after_data jsonb, ip_address inet, user_agent, created_at`

## 18. API tokens

### `api_tokens`
Generic table backing `lead_sources.source_token_hash` issuance/rotation
audit trail: `id, organization_id, lead_source_id, token_hash, last_used_at,
revoked_at, created_at`

## 19. Routing health

### `routing_health_metrics`
Per spec §45, one row per organization per time bucket, refreshed by Cron:
`id, organization_id, bucket_start, bucket_end, leads_received,
leads_assigned, leads_awaiting_acceptance, assignments_expired,
leads_reassigned, leads_in_manual_review, no_matching_rule_count,
no_eligible_user_count, users_at_capacity_count, unavailable_users_count,
territories_without_users_count, territory_conflicts_count,
crm_sync_failures, webhook_failures, median_routing_time_ms,
median_acceptance_time_ms, assignment_success_rate, manual_routing_rate,
created_at`

## 20. Constraints summary (spec §51 → implementation)

| Spec constraint | Implementation |
|---|---|
| 1. Unique custom variable key per org | unique (`organization_id`,`internal_key`) on `custom_variable_definitions` |
| 2. Unique recipient attribute key per org | unique (`organization_id`,`internal_key`) on `recipient_attribute_definitions` |
| 3. Unique source token hash | global unique on `lead_sources.source_token_hash` |
| 4. Unique active assignment per lead | partial unique index on `assignments.lead_id` where status in (pending,notified,viewed) |
| 5. Unique idempotency key per source | unique (`lead_source_id`,`idempotency_key`) on `submission_logs` |
| 6. Unique external submission id per source | unique (`lead_source_id`,`external_submission_id`) where not null, on `leads` |
| 7. Unique external CRM record link per provider+org | unique (`provider`,`organization_id`,`external_record_id`) on `external_record_links` |
| 8. No cross-org FKs | every FK between tenant tables additionally checked by a trigger or generated column comparing `organization_id` on both sides where the FK alone can't express it (e.g. `assignments.user_id` must belong to the same org — enforced via a `BEFORE INSERT/UPDATE` trigger, not just the FK) |
| 9. Immutable published routing versions | trigger blocking UPDATE/DELETE on `routing_flow_versions`/`routing_rule_versions` once `published_at` is set |
| 10. Required org ownership | `organization_id not null` + `not deferrable` FK on every tenant table |
| 11. Unique team name within org | unique (`organization_id`,`name`) on `teams` |
| 12. Valid assignment weight | `check (assignment_weight > 0)` on `user_assignment_settings` |
| 13. Valid capacity values | `check (daily_lead_limit >= 0 and active_lead_limit >= 0)` |
| 14. Valid assignment state transitions | enforced inside the `accept_assignment`/`decline_assignment`/`expire_assignment`/`reassign_lead` functions, not by a bare CHECK, since transitions depend on current state |

## 21. Indexing notes

- Every RLS-filtered table gets a btree index on `organization_id` (or a
  composite leading with it) since it appears in every policy predicate.
- `leads(organization_id, assigned_user_id)`, `leads(organization_id,
  lead_status)`, `assignments(organization_id, status)` support the lead
  list/filter and routing health queries.
- `territories` gets a GIST index on `center_geography` for radius
  queries (PostGIS).
- `activities(lead_id, created_at)` supports timeline rendering.
- `team_users(team_id, is_manager)` supports the role-scoped RLS policies
  in `docs/security-model.md` §1.

## 22. Migration reversibility and destructive-operation policy

Per audit requirement: migrations are forward-only files under
`supabase/migrations/` (CLAUDE.md rule 9), but "reversible where
practical" means:

1. Every migration is additive by default (new table, new column with a
   default or nullable, new index, new policy). Additive migrations are
   trivially "reversed" by a follow-up migration that drops the added
   object, so no destructive step is ever required to undo a mistake made
   same-day in local/preview environments.
2. A migration that would be destructive against real data (dropping a
   column, dropping a table, tightening a constraint that could reject
   existing rows, changing a column type) is written as its own isolated
   migration, called out explicitly in the PR description, and requires
   one extra reviewer acknowledgment before merge — never bundled silently
   into an additive migration.
3. Local development uses `supabase db reset` freely (drops and replays
   all migrations against the local stack) — this is the practical
   "reversibility" mechanism pre-production. It is never run with
   `--linked` (CLAUDE.md rule 12).
4. Against a linked (preview/production) database, there is no automatic
   "down" migration; rollback of a bad migration is a new forward-only
   migration that reverts the change, written and reviewed like any other
   migration — never a manual schema edit (CLAUDE.md rule 9) and never a
   linked destructive command without explicit user approval (CLAUDE.md
   rule 11). See `docs/decisions.md` ADR-012.
5. Destructive linked-database operations (`drop table`, `truncate`,
   `delete` without a `where` tied to a specific reviewed cleanup, `db
   reset --linked`) are not part of normal development workflow at all —
   they only ever happen as a deliberate, user-approved, documented
   action, per CLAUDE.md rules 10–12.
