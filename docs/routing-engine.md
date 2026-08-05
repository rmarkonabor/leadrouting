# Routing Engine

Source: `docs/phase1-product-spec.md` §25–§35. This is the core of the
product; this document is the detailed design for the `routing` and
`assignments` modules and their backing Postgres database functions.

## 1. Model

```
routing_flows (draft/active/inactive/archived, one default team/user + acceptance deadline)
  -> routing_flow_versions (immutable snapshot, created on publish)
       -> routing_rule_versions (frozen copy of routing_rules at publish time, ordered by priority)
routing_rules (mutable working copy, edited pre-publish)
routing_state (per team+flow round-robin cursor, updated atomically)
```

Only a `routing_flow_version` (never the mutable `routing_rules`) is used
to route a live lead. Publishing copies every current `routing_rules` row
for that flow into `routing_rule_versions` linked to the new
`routing_flow_version_id`, then flips the flow to that version. Past
versions are never edited or deleted (spec §25 "historical routing
versions must never change after publication").

## 2. Condition evaluation

Each `routing_rule` has `match_type` (`match_all`/`match_any`) and a
`conditions` array. Each condition references either a default lead field
(spec §26 list) or an active custom lead variable, plus an operator from
spec §27 appropriate to its data type (text/number/currency/date/boolean/
geographic). The evaluator (`modules/routing/evaluate-conditions.ts`,
pure/no-IO) takes the mapped+normalized lead and a rule's `conditions`
JSON and returns `{ passed: boolean, results: ConditionResult[] }` — the
per-condition results are what gets stored as part of the routing
explanation (spec §33).

Geographic operators (`matches_territory`, `within_radius`) delegate to a
territory-matching function that queries `territories` (including PostGIS
`ST_DWithin` for radius) scoped to the lead's organization and its
normalized internal location (`lead_locations_internal`), never the raw
submitted address.

## 3. Eligibility filtering (spec §30 steps 6–14)

Given a rule's matched action (assign to team/user, use round robin,
etc.), the engine builds a candidate user set and removes candidates in
this fixed order, recording a stable exclusion code (spec §33) for each
removed candidate:

1. `NOT_IN_SELECTED_TEAM` — user not a member of the required team.
2. `TEAM_INACTIVE` — the team itself is inactive.
3. `USER_INACTIVE` — `organization_users.status != active`.
4. `USER_UNAVAILABLE` — `user_availability.availability_status` not
   `available`, or `user_assignment_settings.accept_leads = false`.
5. `OUTSIDE_WORKING_HOURS` — current time (lead's evaluated timestamp) not
   within the user's `working_hours` for their `timezone`.
6. `DAILY_CAPACITY_REACHED` — count of assignments created for that user
   today `>= daily_lead_limit`.
7. `ACTIVE_CAPACITY_REACHED` — count of the user's non-terminal
   assignments `>= active_lead_limit`.
8. `TERRITORY_NOT_MATCHED` / `TERRITORY_INACTIVE` — user's territory
   coverage doesn't include the lead's location, or the matching territory
   is inactive.
9. `RECIPIENT_ATTRIBUTE_NOT_MATCHED` — rule's `recipient_requirements`
   reference an attribute the user's `recipient_attribute_values` doesn't
   satisfy.
10. `PREVIOUSLY_DECLINED` — user already has a `declined` or `expired`
    `assignment_attempts` row for this same lead.

Whatever remains is the eligible set passed to the assignment algorithm.

## 4. Assignment algorithms

- **Direct** (§29.1): the rule names a specific `user_id`; still subject
  to the full eligibility filter — an ineligible named user falls through
  to fallback, not a bypass.
- **Team round robin** (§29.2): eligible users ordered by
  `team_users.created_at`/`id`; the next one after
  `routing_state.last_assigned_user_id` is selected; the cursor row is
  locked (`SELECT ... FOR UPDATE`) before reading, and updated in the same
  transaction as assignment creation, so concurrent routing calls cannot
  select the same "next" user twice.
- **Weighted round robin** (§29.3): a cumulative-weight cursor
  (`routing_state.rotation_cursor`) walks a virtual sequence built from
  each eligible user's `assignment_weight`; capacity/availability filters
  run _before_ weight-based selection, per spec, so a highly-weighted but
  unavailable user never consumes a rotation slot.
- **Fallback** (§29.4): if the primary algorithm yields no eligible user,
  the rule's (or flow's) `default_user_id`/`default_team_id` is tried
  through the same eligibility filter; if that also fails, the lead goes
  to manual review with reason `no_eligible_user` or
  `all_users_at_capacity`/`all_users_unavailable` depending on which
  filter step eliminated everyone.

## 5. The `route_lead` transaction

Implements spec §30's 22-step list as one Postgres function:

```
route_lead(lead_id uuid) returns assignments
  BEGIN
    SELECT ... FROM routing_state/leads WHERE lead_id = $1 FOR UPDATE;      -- lock
    IF exists active assignment THEN RAISE / return existing;               -- guard
    SELECT published routing_flow_version for the lead's source's flow;
    FOR EACH routing_rule_version ORDER BY priority:
      evaluate conditions; IF matched THEN break (respecting stop_processing);
    build eligible team/user set per §3 above, recording assignment_attempts;
    run assignment algorithm per §4;
    IF selected user:
      INSERT INTO assignments (...);
      UPDATE leads SET assigned_team_id, assigned_user_id, assignment_status;
      UPDATE routing_state (round robin cursor) atomically;
      INSERT INTO activities (assignment_created, routing_rule_matched, ...);
      INSERT dedupe row into integration_jobs for assignment_notifications queue message;
    ELSE:
      INSERT INTO manual_review_items (...);
      INSERT INTO activities (routing_failed / manual_review_started);
    COMMIT;
  END
```

`accept_assignment`, `decline_assignment`, `expire_assignment`, and
`reassign_lead` are separate functions with the same locking discipline:
each locks the target `assignments` row (and the parent lead's routing
lock) before checking/transitioning state, so a decline and an expiration
racing on the same assignment can't both succeed. `reassign_lead` re-runs
the same eligibility+algorithm logic as `route_lead` but with the
previously-attempted user(s) excluded via `PREVIOUSLY_DECLINED`/expired
`assignment_attempts` rows.

`accept_assignment`/`decline_assignment` are idempotent: calling either
again on an already-`accepted`/`declined` assignment is a no-op that
returns the current state rather than erroring, per spec §32 ("repeated
accept or decline requests must be idempotent").

## 6. Routing explanation (spec §33)

`assignments.explanation` (and `assignment_attempts` rows) store the
structured result of the above: flow/version ids, the ordered list of
rules evaluated with per-condition pass/fail, the matched rule, territory
matches, eligible/excluded user lists with exclusion codes, the algorithm
used, the selected user, fallback outcome, and timestamps for each
pipeline stage. The human-readable explanation shown in the UI is rendered
from this JSON by a pure formatting function — never generated by a model,
per spec §33's explicit prohibition on AI-generated explanations.

## 7. Simulator (spec §34)

`simulate_routing(payload, source_id)` runs the identical mapping,
validation, condition-evaluation, and eligibility-filter code as the live
path (shared functions, not a parallel reimplementation — this is the only
way to guarantee simulator/live parity, a release-blocking test per spec
§54) but:

- reads `routing_state` without `FOR UPDATE` and without writing back,
- never inserts into `leads`, `assignments`, `activities`, or
  `manual_review_items`,
- never enqueues queue messages,
- returns the same explanation structure as a live routing call would,
  labeled as simulated.

This guarantees "simulation does not change live state" (spec §34, §54)
by construction rather than by convention.
