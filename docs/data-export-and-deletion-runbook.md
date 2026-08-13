# Organization Data Export and Deletion Runbook

Satisfies `docs/phase1-product-spec.md` §52 items 20 ("organization data
export") and 21 ("organization data deletion procedures"). Per
`docs/implementation-plan.md` Milestone 9: **both are operational
runbooks executed by an authorized engineer with explicit approval, not
self-service UI actions in Phase 1.** There is no in-app "export my data"
or "delete my organization" button — an `org_admin` who wants either must
request it through a support channel, and the request is fulfilled by
following this document.

This is deliberately not automated. Automating deletion of a whole
organization's data is exactly the kind of high-blast-radius, hard-to-
reverse action CLAUDE.md rules 10–12 exist to gate behind explicit human
approval — building a one-click version of it would work against that.

## 1. Scope: every tenant-owned table

Every table below carries `organization_id uuid not null references
organizations(id) on delete cascade` (verified against all 10
`supabase/migrations/` files as of Milestone 9 — see
`docs/database-schema.md` §22.1's migration audit for the same file list).
Because every one of them cascades from `organizations`, **deleting one
`organizations` row deletes all of it** — this is the mechanism deletion
relies on (§3 below), and the full list below is exactly what export must
also cover (§2 below):

```
organization_users, teams, team_users, user_availability,
user_assignment_settings, recipient_attribute_definitions,
recipient_attribute_values, import_jobs, import_rows, audit_logs,
lead_sources, api_tokens, field_mappings, custom_variable_definitions,
leads, lead_custom_values, lead_duplicates, submission_logs, territories,
territory_users, territory_teams, lead_locations_internal, routing_flows,
routing_flow_versions, routing_rules, routing_rule_versions,
routing_state, assignments, assignment_attempts, manual_review_items,
activities, notifications, integration_jobs, lead_status_definitions,
lead_status_history, notes, routing_health_metrics,
integration_connections, integration_field_mappings,
external_record_links, integration_logs, webhook_endpoints,
webhook_deliveries
```

`intake_rate_limit_counters` has no direct `organization_id` column but
cascades transitively via `lead_source_id references lead_sources(id) on
delete cascade`, so it is covered without being queried directly.

**Explicitly out of scope, by design**: `organizations` itself (the row
being deleted/exported, not a child of it) and `user_profiles`/
`auth.users`. A person's Supabase Auth account and profile are not
organization data — the same person may belong to other organizations —
so neither export nor deletion touches them. If a specific person also
wants their own account deleted, that is a separate request handled
through standard Supabase Auth account deletion, not this runbook.

**Never exported in readable form**: `integration_connections
.credentials_encrypted` and `webhook_endpoints.secret_encrypted` are
AES-256-GCM ciphertext (`lib/crypto/secret-box.ts`, ADR-051). An export
includes these columns' encrypted values as opaque blobs — never
decrypted for the export — since an org admin receiving their own export
has no legitimate need to see a live CRM access token or webhook signing
secret in plaintext, and doing so would defeat the point of encrypting
them at rest.

## 2. Data export procedure

1. **Verify the request.** Confirm the requester is an `org_admin` of the
   organization in question (check `organization_users` for an `active`,
   `org_admin` row) through the support channel's normal identity
   verification — never solely on the basis of an email claiming to be
   them.
2. **Get the organization's id.**
   ```sql
   select id, name, slug from organizations where slug = '<the org's slug>';
   ```
3. **Export every table in §1**, scoped by that `organization_id`, using
   the Supabase SQL Editor's CSV/JSON export or `psql \copy`, one file per
   table, e.g.:
   ```sql
   \copy (select * from leads where organization_id = '<org_id>') to 'leads.csv' with csv header;
   ```
   Repeat for every table listed in §1. A short script that loops over the
   table list and runs one `\copy` per table is acceptable and encouraged
   for consistency — it must not be a service the application exposes to
   end users, only an internal operator tool run against the project's
   Postgres connection string.
4. **Package the files** (one archive, e.g. `<org-slug>-export-<date>.zip`)
   and deliver them to the verified requester through a channel appropriate
   for the data's sensitivity (this contains lead PII — names, emails,
   phones, addresses, consent records). Do not email the archive
   unencrypted; use a password-protected archive or a time-limited secure
   download link, with the password/link shared through a separate
   channel.
5. **Record the export** as an `audit_logs` entry
   (`action = 'organization_data_exported'`, `actor_user_id` = the
   operator who ran it, `entity_type = 'organization'`,
   `entity_id = '<org_id>'`) so the export itself is part of the
   organization's own audit history (spec §52 item 22).
6. **Delete the local export files** from the operator's machine once
   delivery is confirmed — the archive should not persist outside the
   delivery channel's own retention policy.

## 3. Data deletion procedure

Deletion is **destructive and irreversible** — it is exactly the kind of
action CLAUDE.md rules 10–12 require explicit, deliberate, user-approved
handling for, never a routine or automated one.

1. **Verify the request and get explicit written approval** from both the
   requesting `org_admin` and an internal decision-maker before touching
   anything. Confirm this is genuinely account closure/deletion, not a
   support request that could be solved by disabling the organization
   instead (`organizations.status = 'suspended'`, fully reversible, no
   data loss — prefer this whenever the underlying need is "stop this
   org from being usable," not "erase everything").
2. **Run the export procedure in §2 first**, unless the requester
   explicitly declines a copy. Deletion should not be the only chance to
   ever retrieve the data.
3. **Confirm no other organization's data is affected.** Every table's
   cascade path in §1 is scoped through `organization_id`; deleting a
   single `organizations` row cannot reach another organization's rows,
   since there is no query involved — it is exactly one row's cascade.
4. **Run the deletion**, directly on the project's Postgres connection
   (never through the application, never through the service-role client
   in a request path — this is a manual, one-off DBA action):
   ```sql
   delete from organizations where id = '<org_id>';
   ```
   This single statement cascades through every table in §1 automatically,
   per the `on delete cascade` foreign keys already in place — there is no
   need to (and no safe reason to) delete child tables individually first.
5. **Verify deletion**:
   ```sql
   select count(*) from organizations where id = '<org_id>'; -- expect 0
   select count(*) from leads where organization_id = '<org_id>'; -- expect 0
   ```
6. **Record the deletion** in a location outside the deleted organization's
   own `audit_logs` (which no longer exists) — e.g. a shared ops log or
   ticket — noting who approved it, who executed it, the timestamp, and
   confirmation that an export was completed first (or that it was
   explicitly declined).

## 4. What this runbook deliberately does not build

Per the Milestone 9 kickoff ("no new product surface, only gating work")
and CLAUDE.md rule 3 (never add scope beyond the spec), this milestone
does **not** add: a self-service export/delete UI, a scheduled/automatic
data-retention deletion job, or a public API endpoint for either
operation. If a future milestone's spec calls for self-service export or
deletion, it should reuse the same table list and cascade mechanism
documented here rather than re-deriving it.
