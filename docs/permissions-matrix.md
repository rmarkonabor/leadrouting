# Permissions Matrix

Source: `docs/phase1-product-spec.md` §8 (roles), §9 (tenant isolation),
§36 (lead visibility scoping). Three roles per organization membership:
`org_admin`, `team_manager`, `agent` (`organization_users.role`). A person
can hold different roles in different organizations — role is always
evaluated per-membership, never globally.

Enforcement layer legend: **RLS** = Postgres row-level security policy,
**Server** = application-layer check in a module/Server Action before the
query runs, **Both** = defense in depth (RLS is the backstop even if the
server check has a bug).

## Organization & users

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| Manage organization settings | ✅ | ❌ | ❌ | org | Both |
| Invite users | ✅ | ❌ | ❌ | org | Both |
| Deactivate users | ✅ | ❌ | ❌ | org | Both |
| Assign roles | ✅ | ❌ | ❌ | org | Both |
| Bulk import users | ✅ | ❌ | ❌ | org | Both |
| View own profile / update own availability | ✅ | ✅ | ✅ | self | Both |
| Export organization data | ✅ | ❌ | ❌ | org | Server (audited) |

## Teams

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| Create/update teams | ✅ | ❌ | ❌ | org | Both |
| Manage team membership | ✅ | ❌ | ❌ | org | Both |
| View users in a team | ✅ | ✅ (permitted teams only) | ❌ | org / team | Both |
| View team routing health / performance | ✅ | ✅ (permitted teams only) | ❌ | org / team | Both |

"Permitted teams" for a `team_manager` = teams where that user has a
`team_users` row **and** is designated manager (a `team_users.is_manager`
flag, or equivalently the role is only meaningful when combined with team
membership — see `docs/decisions.md` for which of these two designs is
chosen before Milestone 2).

## Recipient attributes, territories, lead sources, custom variables, field mapping, routing configuration

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| Create/update recipient attributes | ✅ | ❌ | ❌ | org | Both |
| Create/update territories, resolve conflicts | ✅ | ❌ | ❌ | org | Both |
| Create/update lead sources & tokens | ✅ | ❌ | ❌ | org | Both |
| Create/update custom lead variables | ✅ | ❌ | ❌ | org | Both |
| Configure field mappings | ✅ | ❌ | ❌ | org | Both |
| Create/publish/test routing flows & rules | ✅ | ❌ | ❌ | org | Both |
| Run the routing simulator | ✅ | ❌ | ❌ | org | Server |

## Leads

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| View lead list / detail | ✅ (all org leads) | ✅ (leads assigned to permitted teams) | ✅ (leads assigned to them) | org / team / self | RLS |
| Manually assign / reassign a lead | ✅ | ✅ (within permitted teams) | ❌ | org / team | Both |
| Accept / decline own assignment | ❌ (not an assignee unless also an agent) | ❌ | ✅ (own assignments only) | self | Both |
| Update lead status | ✅ | ✅ (permitted teams) | ✅ (own assigned leads) | org / team / self | Both |
| Add notes | ✅ | ✅ (permitted teams) | ✅ (own assigned leads) | org / team / self | Both |
| View activity timeline | ✅ | ✅ (permitted teams) | ✅ (own assigned leads) | org / team / self | RLS |
| View original raw payload | ✅ | ❌ | ❌ | org | Server (extra check beyond lead visibility) |

## Manual review

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| View manual review queue | ✅ (all) | ✅ (permitted teams) | ❌ | org / team | RLS |
| Resolve / dismiss manual review items | ✅ | ✅ (permitted teams) | ❌ | org / team | Both |

## Integrations, webhooks, logs, audit

| Capability | org_admin | team_manager | agent | Scope | Enforcement |
|---|---|---|---|---|---|
| Configure CRM integration | ✅ | ❌ | ❌ | org | Both |
| Configure outbound webhooks | ✅ | ❌ | ❌ | org | Both |
| View submission logs | ✅ | ❌ | ❌ | org | Both |
| View integration logs | ✅ | ❌ | ❌ | org | Both |
| View audit logs | ✅ | ❌ | ❌ | org | Both |
| View routing health dashboard | ✅ (org-wide) | ✅ (permitted teams) | ❌ | org / team | RLS + Server |

## Cross-cutting rules

1. Every row above that says "org" scope still requires the request to
   carry a verified `organization_id` resolved server-side from
   `organization_users` — role alone never grants access across
   organizations (spec §9).
2. `inactive`/`suspended` members lose all capabilities regardless of role
   (spec §10) — checked in the same RLS predicate and in server-side
   session resolution (`docs/security-model.md`).
3. Administrators overriding availability/capacity during manual
   assignment (spec §12) is an `org_admin`/permitted `team_manager`
   capability, logged to `audit_logs` as `availability_overridden`.
4. No role can edit `activities` or `audit_logs` rows after creation
   (spec §39, §46) — enforced by omitting UPDATE/DELETE grants entirely,
   not just by role checks.
