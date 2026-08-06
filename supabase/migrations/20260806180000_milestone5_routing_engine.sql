-- Milestone 5: Routing engine and routing simulator. See
-- docs/routing-engine.md, docs/phase1-product-spec.md §25-35,
-- docs/decisions.md (this milestone's ADRs document every locking and
-- transaction decision, per the milestone's explicit requirement).
--
-- Architecture note: condition evaluation, eligibility filtering, and
-- assignment-algorithm selection are implemented here in PL/pgSQL, not in
-- TypeScript, even though every other module in this codebase favors pure
-- TS logic with thin SQL writes. This is a deliberate exception: the
-- public, session-less lead-intake path (Milestone 3) must be able to
-- trigger routing immediately after creating a lead, and the `anon`
-- Postgres role that path runs as has zero read access to
-- organization_users/user_availability/team_users/etc. (RLS-gated to
-- `authenticated`). A TypeScript orchestration layer calling ordinary
-- RLS-scoped queries could not compute a routing decision for that caller.
-- Equivalent pure-TypeScript modules (modules/routing/*.ts) implement and
-- unit-test the same rules as a fast, always-runnable specification of the
-- intended behavior; this SQL is the authoritative, live implementation.
-- See docs/decisions.md for the specific locking/transaction ADRs.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.routing_flow_status as enum ('draft', 'active', 'inactive', 'archived');
create type public.routing_match_type as enum ('match_all', 'match_any');
create type public.assignment_status as enum (
  'pending', 'notified', 'viewed', 'accepted', 'declined', 'expired', 'reassigned', 'cancelled'
);
create type public.assignment_algorithm as enum (
  'direct', 'round_robin', 'weighted_round_robin', 'fallback', 'manual'
);
create type public.assignment_attempt_outcome as enum ('assigned', 'no_eligible_user', 'manual_review');
create type public.manual_review_reason as enum (
  'no_matching_rule', 'no_eligible_user', 'missing_required_data', 'missing_location',
  'ambiguous_location', 'invalid_location', 'duplicate_review', 'all_users_at_capacity',
  'all_users_unavailable', 'assignment_attempts_exhausted', 'manual_request', 'submission_mapping_error'
);
create type public.manual_review_status as enum ('open', 'resolved', 'dismissed');
-- Scoped to this milestone's routing events only; spec §39 defines a much
-- larger activity-type set spanning later milestones (notes, status
-- changes, etc.) that don't exist yet. Widened via ALTER TYPE ADD VALUE in
-- whichever future migration introduces those events — see docs/decisions.md.
create type public.activity_type as enum (
  'assignment_created', 'assignment_accepted', 'assignment_declined',
  'assignment_expired', 'assignment_reassigned', 'manual_review_created'
);

-- ---------------------------------------------------------------------------
-- Widen leads.assignment_status now that real assignment states exist
-- (docs/decisions.md ADR-031 anticipated this exact migration).
-- ---------------------------------------------------------------------------

alter table public.leads drop constraint leads_assignment_status_check;
alter table public.leads add constraint leads_assignment_status_check
  check (assignment_status in ('unassigned', 'assigned', 'accepted', 'manual_review'));

-- ---------------------------------------------------------------------------
-- routing_flows
-- ---------------------------------------------------------------------------

create table public.routing_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status public.routing_flow_status not null default 'draft',
  default_team_id uuid references public.teams(id) on delete set null,
  default_user_id uuid references auth.users(id) on delete set null,
  acceptance_deadline_minutes int not null default 30 check (acceptance_deadline_minutes > 0),
  -- Set once publish_routing_flow() creates the first version; never points
  -- at a version belonging to a different flow (enforced by the publish
  -- function, the only writer of this column).
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

comment on table public.routing_flows is
  'Per docs/database-schema.md §9 / spec §25. org_admin CUD only. Only a '
  'flow with status = active and current_version_id set may route live leads.';

create index routing_flows_organization_id_idx on public.routing_flows (organization_id);
create index routing_flows_organization_active_idx
  on public.routing_flows (organization_id, published_at desc)
  where status = 'active';

create trigger routing_flows_set_updated_at
  before update on public.routing_flows
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- routing_flow_versions (immutable once created)
-- ---------------------------------------------------------------------------

create table public.routing_flow_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  routing_flow_id uuid not null references public.routing_flows(id) on delete cascade,
  version_number int not null check (version_number > 0),
  published_at timestamptz not null default now(),
  published_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint routing_flow_versions_flow_version_unique unique (routing_flow_id, version_number)
);

comment on table public.routing_flow_versions is
  'Per docs/database-schema.md §9 / spec §25. Immutable once inserted — '
  '"historical routing versions must never change after publication." See '
  'the immutability trigger below and docs/decisions.md.';

create index routing_flow_versions_organization_id_idx on public.routing_flow_versions (organization_id);
create index routing_flow_versions_flow_id_idx on public.routing_flow_versions (routing_flow_id);

create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are immutable once created', TG_TABLE_NAME using errcode = '23514';
end;
$$;

create trigger routing_flow_versions_immutable_update
  before update on public.routing_flow_versions
  for each row
  execute function public.reject_mutation();

create trigger routing_flow_versions_immutable_delete
  before delete on public.routing_flow_versions
  for each row
  execute function public.reject_mutation();

alter table public.routing_flows
  add constraint routing_flows_current_version_fkey
  foreign key (current_version_id) references public.routing_flow_versions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- routing_rules (mutable draft copy) / routing_rule_versions (frozen snapshot)
-- ---------------------------------------------------------------------------

create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  routing_flow_id uuid not null references public.routing_flows(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  priority int not null default 100,
  match_type public.routing_match_type not null default 'match_all',
  conditions jsonb not null default '[]'::jsonb,
  recipient_requirements jsonb not null default '[]'::jsonb,
  action jsonb not null,
  stop_processing boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.routing_rules is
  'Per docs/database-schema.md §9 / spec §26. Working/draft copy, editable '
  'pre-publish. org_admin CUD only. Never used to route a live lead — see '
  'routing_rule_versions.';

create index routing_rules_organization_id_idx on public.routing_rules (organization_id);
create index routing_rules_flow_priority_idx on public.routing_rules (routing_flow_id, priority);

create trigger routing_rules_set_updated_at
  before update on public.routing_rules
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_routing_rule_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.routing_flows rf
    where rf.id = new.routing_flow_id and rf.organization_id = new.organization_id
  ) then
    raise exception 'routing flow % does not belong to organization %', new.routing_flow_id, new.organization_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger routing_rules_assert_same_org
  before insert or update on public.routing_rules
  for each row
  execute function public.assert_routing_rule_same_org();

create table public.routing_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  routing_flow_version_id uuid not null references public.routing_flow_versions(id) on delete cascade,
  name text not null,
  priority int not null,
  match_type public.routing_match_type not null,
  conditions jsonb not null default '[]'::jsonb,
  recipient_requirements jsonb not null default '[]'::jsonb,
  action jsonb not null,
  stop_processing boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.routing_rule_versions is
  'Per docs/database-schema.md §9 / spec §26. Frozen snapshot of '
  'routing_rules captured at publish time. Immutable once inserted.';

create index routing_rule_versions_organization_id_idx on public.routing_rule_versions (organization_id);
create index routing_rule_versions_flow_version_priority_idx
  on public.routing_rule_versions (routing_flow_version_id, priority);

create trigger routing_rule_versions_immutable_update
  before update on public.routing_rule_versions
  for each row
  execute function public.reject_mutation();

create trigger routing_rule_versions_immutable_delete
  before delete on public.routing_rule_versions
  for each row
  execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- routing_state (per-team round robin cursor)
-- ---------------------------------------------------------------------------

create table public.routing_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  routing_flow_id uuid not null references public.routing_flows(id) on delete cascade,
  last_assigned_user_id uuid references auth.users(id) on delete set null,
  rotation_cursor int not null default 0,
  updated_at timestamptz not null default now(),
  constraint routing_state_org_team_flow_unique unique (organization_id, team_id, routing_flow_id)
);

comment on table public.routing_state is
  'Per docs/database-schema.md §9. One row per (team, flow) — the atomic '
  'round-robin cursor. Every read that will inform a live assignment '
  'decision takes `SELECT ... FOR UPDATE` on this row first — see '
  'docs/decisions.md''s locking ADR for this milestone.';

create index routing_state_organization_id_idx on public.routing_state (organization_id);

create trigger routing_state_set_updated_at
  before update on public.routing_state
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  routing_flow_id uuid references public.routing_flows(id) on delete set null,
  routing_flow_version_id uuid references public.routing_flow_versions(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status public.assignment_status not null default 'pending',
  assignment_algorithm public.assignment_algorithm not null,
  acceptance_deadline_at timestamptz,
  notified_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.assignments is
  'Per docs/database-schema.md §10 / spec §30-33. The partial unique index '
  'below enforces "at most one active assignment per lead" at the database '
  'level — see docs/decisions.md.';

create unique index assignments_one_active_per_lead_idx
  on public.assignments (lead_id)
  where status in ('pending', 'notified', 'viewed');

create index assignments_organization_id_idx on public.assignments (organization_id);
create index assignments_lead_id_idx on public.assignments (lead_id);
create index assignments_organization_user_idx on public.assignments (organization_id, user_id);
create index assignments_organization_status_idx on public.assignments (organization_id, status);

create trigger assignments_set_updated_at
  before update on public.assignments
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_assignment_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'lead % does not belong to organization %', new.lead_id, new.organization_id
      using errcode = '23514';
  end if;

  if new.user_id is not null and not exists (
    select 1 from public.organization_users ou
    where ou.user_id = new.user_id and ou.organization_id = new.organization_id
  ) then
    raise exception 'user % is not a member of organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger assignments_assert_same_org
  before insert or update on public.assignments
  for each row
  execute function public.assert_assignment_same_org();

-- ---------------------------------------------------------------------------
-- assignment_attempts (full history, including no-eligible-user attempts)
-- ---------------------------------------------------------------------------

create table public.assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  routing_rule_version_id uuid references public.routing_rule_versions(id) on delete set null,
  eligible_team_ids jsonb not null default '[]'::jsonb,
  eligible_user_ids jsonb not null default '[]'::jsonb,
  excluded jsonb not null default '[]'::jsonb,
  selected_user_id uuid references auth.users(id) on delete set null,
  outcome public.assignment_attempt_outcome not null,
  created_at timestamptz not null default now()
);

comment on table public.assignment_attempts is
  'Per docs/database-schema.md §10. One row per route_lead/reassign_lead '
  'invocation — insert-only, the full explanation record.';

create index assignment_attempts_organization_id_idx on public.assignment_attempts (organization_id);
create index assignment_attempts_lead_id_idx on public.assignment_attempts (lead_id);

-- ---------------------------------------------------------------------------
-- manual_review_items
-- ---------------------------------------------------------------------------

create table public.manual_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  reason public.manual_review_reason not null,
  status public.manual_review_status not null default 'open',
  resolved_by_user_id uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.manual_review_items is
  'Per docs/database-schema.md §11 / spec §35.';

create index manual_review_items_organization_id_idx on public.manual_review_items (organization_id, status);
create index manual_review_items_lead_id_idx on public.manual_review_items (lead_id);

create trigger manual_review_items_set_updated_at
  before update on public.manual_review_items
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities (insert-only)
-- ---------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type public.activity_type not null,
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activities is
  'Per docs/database-schema.md §12 / spec §39. Insert-only — no application '
  'role ever receives UPDATE/DELETE grants, matching audit_logs.';

create index activities_organization_id_idx on public.activities (organization_id);
create index activities_lead_id_created_at_idx on public.activities (lead_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.routing_flows enable row level security;
alter table public.routing_flow_versions enable row level security;
alter table public.routing_rules enable row level security;
alter table public.routing_rule_versions enable row level security;
alter table public.routing_state enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_attempts enable row level security;
alter table public.manual_review_items enable row level security;
alter table public.activities enable row level security;

-- routing_flows / routing_flow_versions / routing_rules / routing_rule_versions:
-- any active member reads (agents may want to see which flow applies);
-- org_admin only writes. Versions have no update/delete policy at all —
-- RLS defense-in-depth on top of the trigger above.
create policy routing_flows_select_active_member
  on public.routing_flows for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy routing_flows_insert_org_admin
  on public.routing_flows for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy routing_flows_update_org_admin
  on public.routing_flows for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy routing_flows_delete_org_admin
  on public.routing_flows for delete to authenticated
  using (public.is_org_admin(organization_id));

create policy routing_flow_versions_select_active_member
  on public.routing_flow_versions for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy routing_flow_versions_insert_org_admin
  on public.routing_flow_versions for insert to authenticated
  with check (public.is_org_admin(organization_id));

create policy routing_rules_select_active_member
  on public.routing_rules for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy routing_rules_insert_org_admin
  on public.routing_rules for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy routing_rules_update_org_admin
  on public.routing_rules for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy routing_rules_delete_org_admin
  on public.routing_rules for delete to authenticated
  using (public.is_org_admin(organization_id));

create policy routing_rule_versions_select_active_member
  on public.routing_rule_versions for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy routing_rule_versions_insert_org_admin
  on public.routing_rule_versions for insert to authenticated
  with check (public.is_org_admin(organization_id));

-- routing_state: org_admin only — it is purely internal routing-engine
-- state, never a user-facing read.
create policy routing_state_all_org_admin
  on public.routing_state for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

-- assignments: org_admin sees/manages all; a team_manager sees assignments
-- for permitted teams; an agent sees/updates only their own assignments
-- (accept/decline).
create policy assignments_select_scoped
  on public.assignments for select to authenticated
  using (
    public.is_org_admin(organization_id)
    or (team_id is not null and public.is_permitted_team_manager(team_id))
    or user_id = (select auth.uid())
  );
create policy assignments_insert_org_admin
  on public.assignments for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy assignments_update_scoped
  on public.assignments for update to authenticated
  using (
    public.is_org_admin(organization_id)
    or (team_id is not null and public.is_permitted_team_manager(team_id))
    or user_id = (select auth.uid())
  )
  with check (
    public.is_org_admin(organization_id)
    or (team_id is not null and public.is_permitted_team_manager(team_id))
    or user_id = (select auth.uid())
  );

-- assignment_attempts: org_admin only (diagnostic/explanation detail).
create policy assignment_attempts_all_org_admin
  on public.assignment_attempts for all to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

-- manual_review_items: org_admin all; team_manager permitted teams (via the
-- lead's assigned_team_id, since manual review items aren't team-scoped
-- directly); agents have no access per the permissions matrix.
create policy manual_review_items_select_scoped
  on public.manual_review_items for select to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = manual_review_items.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  );
create policy manual_review_items_update_scoped
  on public.manual_review_items for update to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = manual_review_items.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  )
  with check (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = manual_review_items.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  );
create policy manual_review_items_insert_org_admin
  on public.manual_review_items for insert to authenticated
  with check (public.is_org_admin(organization_id));

-- activities: same read scope as assignments (an agent should see the
-- activity trail for their own leads); insert-only, no update/delete grant
-- to any role.
create policy activities_select_scoped
  on public.activities for select to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = activities.lead_id
        and (
          (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
          or l.assigned_user_id = (select auth.uid())
        )
    )
  );
create policy activities_insert_active_member
  on public.activities for insert to authenticated
  with check (public.is_active_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- publish_routing_flow: creates an immutable routing_flow_version snapshot
-- of the flow's current routing_rules, then flips the flow to point at it.
-- Runs as the caller (not SECURITY DEFINER) — RLS still applies, so only an
-- org_admin with write access to routing_flows/routing_rules can publish.
-- ---------------------------------------------------------------------------

create or replace function public.publish_routing_flow(p_routing_flow_id uuid)
returns public.routing_flow_versions
language plpgsql
as $$
declare
  v_flow record;
  v_next_version int;
  v_version public.routing_flow_versions;
  v_rule record;
begin
  select * into v_flow from public.routing_flows where id = p_routing_flow_id;
  if v_flow.id is null then
    raise exception 'routing flow % not found' , p_routing_flow_id using errcode = '02000';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.routing_flow_versions
  where routing_flow_id = p_routing_flow_id;

  insert into public.routing_flow_versions (
    organization_id, routing_flow_id, version_number, published_by_user_id
  ) values (
    v_flow.organization_id, p_routing_flow_id, v_next_version, auth.uid()
  )
  returning * into v_version;

  for v_rule in
    select * from public.routing_rules where routing_flow_id = p_routing_flow_id order by priority asc
  loop
    insert into public.routing_rule_versions (
      organization_id, routing_flow_version_id, name, priority, match_type,
      conditions, recipient_requirements, action, stop_processing
    ) values (
      v_rule.organization_id, v_version.id, v_rule.name, v_rule.priority, v_rule.match_type,
      v_rule.conditions, v_rule.recipient_requirements, v_rule.action, v_rule.stop_processing
    );
  end loop;

  update public.routing_flows
  set current_version_id = v_version.id, status = 'active', published_at = v_version.published_at
  where id = p_routing_flow_id;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- haversine_distance_meters: great-circle distance, no PostGIS dependency —
-- mirrors modules/territories/match-territories.ts exactly, so radius
-- territory matching behaves identically whether computed in SQL or in the
-- pure TS module's unit tests.
-- ---------------------------------------------------------------------------

create or replace function public.haversine_distance_meters(
  p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    sin(radians(p_lat2 - p_lat1) / 2) ^ 2 +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) * sin(radians(p_lon2 - p_lon1) / 2) ^ 2
  ));
$$;

-- ---------------------------------------------------------------------------
-- is_within_working_hours: timezone-aware working-hours check, mirroring
-- modules/routing/working-hours.ts's semantics (a day with no configured
-- window means unavailable that day).
-- ---------------------------------------------------------------------------

create or replace function public.is_within_working_hours(
  p_evaluated_at timestamptz, p_timezone text, p_working_hours jsonb
)
returns boolean
language plpgsql
stable
as $$
declare
  v_local timestamp;
  v_day text;
  v_window jsonb;
  v_minutes int;
  v_start int;
  v_end int;
begin
  v_local := p_evaluated_at at time zone coalesce(p_timezone, 'UTC');
  v_day := lower(trim(to_char(v_local, 'FMDay')));
  v_window := p_working_hours -> v_day;
  if v_window is null then
    return false;
  end if;

  v_minutes := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_start := split_part(v_window ->> 'start', ':', 1)::int * 60 + split_part(v_window ->> 'start', ':', 2)::int;
  v_end := split_part(v_window ->> 'end', ':', 1)::int * 60 + split_part(v_window ->> 'end', ':', 2)::int;

  return v_minutes >= v_start and v_minutes < v_end;
end;
$$;

-- ---------------------------------------------------------------------------
-- satisfies_recipient_requirement
-- ---------------------------------------------------------------------------

create or replace function public.satisfies_recipient_requirement(p_value jsonb, p_req jsonb)
returns boolean
language plpgsql
stable
as $$
declare
  v_operator text := p_req ->> 'operator';
begin
  if v_operator = 'is_empty' then
    return p_value is null;
  elsif v_operator = 'is_not_empty' then
    return p_value is not null;
  elsif v_operator = 'equals' then
    return p_value is not distinct from (p_req -> 'value');
  elsif v_operator = 'not_equals' then
    return p_value is distinct from (p_req -> 'value');
  elsif v_operator = 'is_in' then
    return p_value is not null and coalesce((p_req -> 'values') @> jsonb_build_array(p_value), false);
  elsif v_operator = 'is_not_in' then
    return p_value is null or not coalesce((p_req -> 'values') @> jsonb_build_array(p_value), false);
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- evaluate_routing_condition: implements spec §27's operator families plus
-- the two geographic operators. Mirrors
-- modules/routing/evaluate-conditions.ts's evaluateCondition exactly — that
-- TS module is the fast, unit-tested specification of this function's
-- intended behavior (see the migration header comment).
-- ---------------------------------------------------------------------------

create or replace function public.evaluate_routing_condition(p_context jsonb, p_condition jsonb)
returns boolean
language plpgsql
stable
as $$
declare
  v_source text := p_condition ->> 'source';
  v_field text := p_condition ->> 'field';
  v_operator text := p_condition ->> 'operator';
  v_actual jsonb;
  v_actual_text text;
  v_value_text text := p_condition ->> 'value';
  v_values jsonb := coalesce(p_condition -> 'values', '[]'::jsonb);
begin
  if v_source = 'territory' then
    if v_operator = 'matches_territory' then
      return coalesce((p_context -> 'matchedTerritoryIds') ? v_value_text, false);
    elsif v_operator = 'within_radius' then
      declare
        v_lat double precision := (p_context -> 'location' ->> 'latitude')::double precision;
        v_lon double precision := (p_context -> 'location' ->> 'longitude')::double precision;
        v_target_lat double precision := (p_condition -> 'value' ->> 'latitude')::double precision;
        v_target_lon double precision := (p_condition -> 'value' ->> 'longitude')::double precision;
        v_radius double precision := (p_condition -> 'value' ->> 'radiusMeters')::double precision;
      begin
        if v_lat is null or v_lon is null or v_target_lat is null or v_target_lon is null or v_radius is null then
          return false;
        end if;
        return public.haversine_distance_meters(v_lat, v_lon, v_target_lat, v_target_lon) <= v_radius;
      end;
    end if;
    return false;
  end if;

  v_actual := (p_context -> 'fields') -> v_field;

  if v_operator = 'is_true' then
    return coalesce(v_actual = 'true'::jsonb, false);
  elsif v_operator = 'is_false' then
    return v_actual is null or v_actual = 'false'::jsonb;
  end if;

  if v_operator = 'is_empty' then
    return v_actual is null or v_actual = 'null'::jsonb or v_actual = to_jsonb(''::text);
  elsif v_operator = 'is_not_empty' then
    return not (v_actual is null or v_actual = 'null'::jsonb or v_actual = to_jsonb(''::text));
  end if;

  v_actual_text := case jsonb_typeof(v_actual) when 'string' then v_actual #>> '{}' else v_actual::text end;

  if v_operator in ('greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal') then
    if v_actual is null or v_actual_text !~ '^-?[0-9]+(\.[0-9]+)?$' or v_value_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
      return false;
    end if;
    return case v_operator
      when 'greater_than' then v_actual_text::numeric > v_value_text::numeric
      when 'less_than' then v_actual_text::numeric < v_value_text::numeric
      when 'greater_than_or_equal' then v_actual_text::numeric >= v_value_text::numeric
      when 'less_than_or_equal' then v_actual_text::numeric <= v_value_text::numeric
    end;
  end if;

  if v_operator in ('before', 'after', 'on_or_before', 'on_or_after') then
    if v_actual is null then
      return false;
    end if;
    return case v_operator
      when 'before' then v_actual_text::timestamptz < v_value_text::timestamptz
      when 'after' then v_actual_text::timestamptz > v_value_text::timestamptz
      when 'on_or_before' then v_actual_text::timestamptz <= v_value_text::timestamptz
      when 'on_or_after' then v_actual_text::timestamptz >= v_value_text::timestamptz
    end;
  end if;

  if v_operator = 'equals' then
    if v_actual_text ~ '^-?[0-9]+(\.[0-9]+)?$' and v_value_text ~ '^-?[0-9]+(\.[0-9]+)?$' then
      return v_actual_text::numeric = v_value_text::numeric;
    end if;
    return lower(coalesce(v_actual_text, '')) = lower(coalesce(v_value_text, ''));
  elsif v_operator = 'not_equals' then
    return not public.evaluate_routing_condition(p_context, jsonb_set(p_condition, '{operator}', '"equals"'));
  elsif v_operator = 'contains' then
    return position(lower(coalesce(v_value_text, '')) in lower(coalesce(v_actual_text, ''))) > 0;
  elsif v_operator = 'not_contains' then
    return position(lower(coalesce(v_value_text, '')) in lower(coalesce(v_actual_text, ''))) = 0;
  elsif v_operator = 'starts_with' then
    return lower(coalesce(v_actual_text, '')) like lower(coalesce(v_value_text, '')) || '%';
  elsif v_operator = 'ends_with' then
    return lower(coalesce(v_actual_text, '')) like '%' || lower(coalesce(v_value_text, ''));
  elsif v_operator = 'is_in' then
    return exists (
      select 1 from jsonb_array_elements_text(v_values) e where lower(e) = lower(coalesce(v_actual_text, ''))
    );
  elsif v_operator = 'is_not_in' then
    return not exists (
      select 1 from jsonb_array_elements_text(v_values) e where lower(e) = lower(coalesce(v_actual_text, ''))
    );
  end if;

  return false;
end;
$$;

create or replace function public.evaluate_routing_rule_conditions(
  p_context jsonb, p_conditions jsonb, p_match_type public.routing_match_type
)
returns boolean
language plpgsql
stable
as $$
declare
  v_condition jsonb;
  v_all_passed boolean := true;
  v_any_passed boolean := false;
  v_count int := 0;
begin
  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    v_count := v_count + 1;
    if public.evaluate_routing_condition(p_context, v_condition) then
      v_any_passed := true;
    else
      v_all_passed := false;
    end if;
  end loop;

  if v_count = 0 then
    return true;
  end if;

  if p_match_type = 'match_any' then
    return v_any_passed;
  end if;
  return v_all_passed;
end;
$$;

-- ---------------------------------------------------------------------------
-- build_lead_routing_context: flattens a lead's default fields + active
-- custom variable values + matched active territory ids into one jsonb
-- object for evaluate_routing_condition to read. SECURITY DEFINER because
-- it is invoked from the anon-safe intake path (via record_lead_submission
-- -> route_lead) as well as authenticated paths — see the migration header.
-- ---------------------------------------------------------------------------

create or replace function public.build_lead_routing_context(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lead record;
  v_custom_values jsonb;
  v_matched_territories uuid[];
  v_location record;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id using errcode = '02000';
  end if;

  select coalesce(jsonb_object_agg(cvd.internal_key, lcv.value), '{}'::jsonb)
  into v_custom_values
  from public.lead_custom_values lcv
  join public.custom_variable_definitions cvd on cvd.id = lcv.variable_definition_id
  where lcv.lead_id = p_lead_id;

  select internal_latitude, internal_longitude into v_location
  from public.lead_locations_internal
  where lead_id = p_lead_id;

  select coalesce(array_agg(t.id), array[]::uuid[])
  into v_matched_territories
  from public.territories t
  where t.organization_id = v_lead.organization_id
    and t.status = 'active'
    and (
      (t.territory_type = 'country' and lower(t.country) = lower(v_lead.country))
      or (
        t.territory_type = 'state_province'
        and lower(t.state_province) = lower(v_lead.state_province)
        and lower(coalesce(t.country, '')) = lower(coalesce(v_lead.country, ''))
      )
      or (
        t.territory_type = 'county'
        and lower(t.county) = lower(v_lead.county)
        and lower(coalesce(t.state_province, '')) = lower(coalesce(v_lead.state_province, ''))
      )
      or (
        t.territory_type = 'city'
        and lower(t.city) = lower(v_lead.city)
        and lower(coalesce(t.state_province, '')) = lower(coalesce(v_lead.state_province, ''))
      )
      or (
        t.territory_type = 'neighborhood'
        and lower(t.neighborhood) = lower(v_lead.neighborhood)
        and lower(coalesce(t.city, '')) = lower(coalesce(v_lead.city, ''))
      )
      or (t.territory_type = 'postal_code' and lower(t.postal_code) = lower(v_lead.postal_code))
      or (
        t.territory_type = 'radius'
        and v_location.internal_latitude is not null
        and v_location.internal_longitude is not null
        and t.center_latitude is not null
        and t.center_longitude is not null
        and public.haversine_distance_meters(
          v_location.internal_latitude, v_location.internal_longitude, t.center_latitude, t.center_longitude
        ) <= t.radius_distance
      )
    );

  return jsonb_build_object(
    'organizationId', v_lead.organization_id,
    'fields', jsonb_build_object(
      'first_name', v_lead.first_name, 'last_name', v_lead.last_name, 'full_name', v_lead.full_name,
      'email', v_lead.email, 'phone', v_lead.phone,
      'street_address', v_lead.street_address, 'unit_number', v_lead.unit_number,
      'neighborhood', v_lead.neighborhood, 'city', v_lead.city, 'county', v_lead.county,
      'state_province', v_lead.state_province, 'postal_code', v_lead.postal_code, 'country', v_lead.country,
      'lead_source_id', v_lead.lead_source_id, 'campaign', v_lead.campaign, 'medium', v_lead.medium,
      'referrer', v_lead.referrer, 'landing_page', v_lead.landing_page,
      'priority', v_lead.priority, 'lead_status', v_lead.lead_status,
      'submission_date', to_char(v_lead.created_at, 'YYYY-MM-DD'),
      'submission_time', to_char(v_lead.created_at, 'HH24:MI'),
      'day_of_week', trim(to_char(v_lead.created_at, 'FMDay'))
    ) || v_custom_values,
    'matchedTerritoryIds', to_jsonb(v_matched_territories),
    'location', jsonb_build_object('latitude', v_location.internal_latitude, 'longitude', v_location.internal_longitude)
  );
end;
$$;

revoke all on function public.build_lead_routing_context(uuid) from public, anon;
grant execute on function public.build_lead_routing_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_candidate_eligibility: removes ineligible candidates in the fixed
-- order from spec §30 steps 7-14 / docs/routing-engine.md §3, one stable
-- exclusion code per removed candidate. Mirrors
-- modules/routing/eligibility.ts's filterEligibleCandidates exactly.
-- ---------------------------------------------------------------------------

create or replace function public.compute_candidate_eligibility(
  p_organization_id uuid,
  p_lead_id uuid,
  p_evaluated_at timestamptz,
  p_team_id uuid,
  p_candidate_user_ids uuid[],
  p_require_territory_match boolean,
  p_matched_territory_ids uuid[],
  p_recipient_requirements jsonb
)
returns table (user_id uuid, eligible boolean, reason_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_active boolean;
  v_uid uuid;
  v_is_member boolean;
  v_is_active boolean;
  v_availability text;
  v_accept_leads boolean;
  v_timezone text;
  v_working_hours jsonb;
  v_daily_limit int;
  v_active_limit int;
  v_today_count int;
  v_active_count int;
  v_territory_ids uuid[];
  v_recipient_ok boolean;
  v_declined boolean;
  v_req jsonb;
  v_attr_value jsonb;
begin
  if p_team_id is not null then
    select (status = 'active') into v_team_active from public.teams where id = p_team_id;
  end if;

  foreach v_uid in array coalesce(p_candidate_user_ids, array[]::uuid[])
  loop
    if p_team_id is not null then
      select exists(
        select 1 from public.team_users tu where tu.team_id = p_team_id and tu.user_id = v_uid
      ) into v_is_member;
      if not v_is_member then
        user_id := v_uid; eligible := false; reason_code := 'NOT_IN_SELECTED_TEAM'; return next; continue;
      end if;
      if not coalesce(v_team_active, false) then
        user_id := v_uid; eligible := false; reason_code := 'TEAM_INACTIVE'; return next; continue;
      end if;
    end if;

    select (ou.status = 'active') into v_is_active
    from public.organization_users ou
    where ou.organization_id = p_organization_id and ou.user_id = v_uid;
    if not coalesce(v_is_active, false) then
      user_id := v_uid; eligible := false; reason_code := 'USER_INACTIVE'; return next; continue;
    end if;

    select ua.availability_status::text into v_availability
    from public.user_availability ua
    where ua.organization_id = p_organization_id and ua.user_id = v_uid;

    select uas.accept_leads, uas.timezone, uas.working_hours, uas.daily_lead_limit, uas.active_lead_limit
    into v_accept_leads, v_timezone, v_working_hours, v_daily_limit, v_active_limit
    from public.user_assignment_settings uas
    where uas.organization_id = p_organization_id and uas.user_id = v_uid;

    if coalesce(v_availability, 'available') != 'available' or not coalesce(v_accept_leads, true) then
      user_id := v_uid; eligible := false; reason_code := 'USER_UNAVAILABLE'; return next; continue;
    end if;

    if not public.is_within_working_hours(p_evaluated_at, coalesce(v_timezone, 'UTC'), coalesce(v_working_hours, '{}'::jsonb)) then
      user_id := v_uid; eligible := false; reason_code := 'OUTSIDE_WORKING_HOURS'; return next; continue;
    end if;

    select count(*) into v_today_count from public.assignments a
    where a.organization_id = p_organization_id and a.user_id = v_uid
      and a.created_at >= date_trunc('day', p_evaluated_at)
      and a.created_at < date_trunc('day', p_evaluated_at) + interval '1 day'
      and a.status != 'cancelled';
    if coalesce(v_daily_limit, 0) > 0 and v_today_count >= v_daily_limit then
      user_id := v_uid; eligible := false; reason_code := 'DAILY_CAPACITY_REACHED'; return next; continue;
    end if;

    select count(*) into v_active_count from public.assignments a
    where a.organization_id = p_organization_id and a.user_id = v_uid
      and a.status in ('pending', 'notified', 'viewed', 'accepted');
    if coalesce(v_active_limit, 0) > 0 and v_active_count >= v_active_limit then
      user_id := v_uid; eligible := false; reason_code := 'ACTIVE_CAPACITY_REACHED'; return next; continue;
    end if;

    if p_require_territory_match then
      select coalesce(array_agg(distinct territory_id), array[]::uuid[]) into v_territory_ids
      from (
        select tu.territory_id from public.territory_users tu
        where tu.user_id = v_uid and tu.organization_id = p_organization_id
        union all
        select tt.territory_id from public.territory_teams tt
        join public.team_users tmu on tmu.team_id = tt.team_id
        where tmu.user_id = v_uid and tt.organization_id = p_organization_id
      ) covered;

      if not (v_territory_ids && p_matched_territory_ids) then
        user_id := v_uid; eligible := false; reason_code := 'TERRITORY_NOT_MATCHED'; return next; continue;
      end if;
    end if;

    v_recipient_ok := true;
    for v_req in select * from jsonb_array_elements(coalesce(p_recipient_requirements, '[]'::jsonb))
    loop
      select rav.value into v_attr_value
      from public.recipient_attribute_values rav
      where rav.user_id = v_uid and rav.attribute_definition_id = (v_req ->> 'attributeDefinitionId')::uuid;

      if not public.satisfies_recipient_requirement(v_attr_value, v_req) then
        v_recipient_ok := false;
        exit;
      end if;
    end loop;
    if not v_recipient_ok then
      user_id := v_uid; eligible := false; reason_code := 'RECIPIENT_ATTRIBUTE_NOT_MATCHED'; return next; continue;
    end if;

    select exists (
      select 1 from public.assignments a
      where a.lead_id = p_lead_id and a.user_id = v_uid and a.status in ('declined', 'expired')
    ) into v_declined;
    if v_declined then
      user_id := v_uid; eligible := false; reason_code := 'PREVIOUSLY_DECLINED'; return next; continue;
    end if;

    user_id := v_uid; eligible := true; reason_code := null; return next;
  end loop;
end;
$$;

revoke all on function public.compute_candidate_eligibility(
  uuid, uuid, timestamptz, uuid, uuid[], boolean, uuid[], jsonb
) from public, anon;
grant execute on function public.compute_candidate_eligibility(
  uuid, uuid, timestamptz, uuid, uuid[], boolean, uuid[], jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_routing_decision: the shared decision core for both route_lead
-- and simulate_routing. When p_lock_state is true, it takes
-- `SELECT ... FOR UPDATE` on the specific routing_state row needed for a
-- round-robin/weighted-round-robin selection before reading its cursor —
-- this is the only place in the whole pipeline that locks anything, and it
-- only runs when a real assignment (not a simulation) is being made. See
-- docs/decisions.md's locking ADR: eligibility filtering itself (many reads
-- across organization_users/user_availability/etc.) deliberately happens
-- *before* any lock is taken, since none of that data races on a
-- concurrent routing call the way the round-robin cursor does — only the
-- final "which position in the rotation" decision needs serialization.
-- ---------------------------------------------------------------------------

create or replace function public.compute_routing_decision(p_lead_id uuid, p_lock_state boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
  v_flow record;
  v_context jsonb;
  v_matched_territory_ids uuid[];
  v_rule record;
  v_matched_rule_id uuid;
  v_matched_rule_action jsonb;
  v_matched_rule_recipient_requirements jsonb;
  v_rules_evaluated jsonb := '[]'::jsonb;
  v_action jsonb;
  v_action_type text;
  v_team_id uuid;
  v_require_territory boolean;
  v_recipient_requirements jsonb;
  v_candidate_ids uuid[];
  v_eligible uuid[] := array[]::uuid[];
  v_excluded jsonb := '[]'::jsonb;
  v_elig_row record;
  v_algorithm text;
  v_selected_user_id uuid;
  v_routing_state record;
  v_outcome text;
  v_manual_review_reason text;
  v_fallback_result jsonb;
  v_evaluated_at timestamptz := now();
  v_ordered uuid[];
  v_last_index int;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id using errcode = '02000';
  end if;

  select rf.* into v_flow
  from public.routing_flows rf
  where rf.organization_id = v_lead.organization_id
    and rf.status = 'active'
    and rf.current_version_id is not null
  order by rf.published_at desc nulls last
  limit 1;

  if v_flow.id is null then
    return jsonb_build_object(
      'routingFlowId', null, 'routingFlowVersionId', null,
      'rulesEvaluated', '[]'::jsonb, 'matchedRuleId', null,
      'territoryMatches', '[]'::jsonb, 'eligibleUsers', '[]'::jsonb, 'excludedUsers', '[]'::jsonb,
      'assignmentAlgorithm', null, 'selectedUserId', null, 'selectedTeamId', null,
      'fallbackResult', null, 'outcome', 'manual_review', 'manualReviewReason', 'no_matching_rule',
      'evaluatedAt', v_evaluated_at
    );
  end if;

  v_context := public.build_lead_routing_context(p_lead_id);
  select array(select (jsonb_array_elements_text(v_context -> 'matchedTerritoryIds'))::uuid)
    into v_matched_territory_ids;

  for v_rule in
    select * from public.routing_rule_versions
    where routing_flow_version_id = v_flow.current_version_id
    order by priority asc
  loop
    if public.evaluate_routing_rule_conditions(v_context, v_rule.conditions, v_rule.match_type) then
      v_matched_rule_id := v_rule.id;
      v_matched_rule_action := v_rule.action;
      v_matched_rule_recipient_requirements := v_rule.recipient_requirements;
      v_rules_evaluated := v_rules_evaluated || jsonb_build_object(
        'ruleId', v_rule.id, 'name', v_rule.name, 'priority', v_rule.priority, 'passed', true
      );
      exit;
    else
      v_rules_evaluated := v_rules_evaluated || jsonb_build_object(
        'ruleId', v_rule.id, 'name', v_rule.name, 'priority', v_rule.priority, 'passed', false
      );
    end if;
  end loop;

  if v_matched_rule_id is not null then
    v_action := v_matched_rule_action;
    v_action_type := v_action ->> 'type';
    v_require_territory := coalesce((v_action ->> 'requireTerritoryMatch')::boolean, false);
    v_recipient_requirements := coalesce(v_matched_rule_recipient_requirements, '[]'::jsonb);

    if v_action_type = 'direct' then
      v_candidate_ids := array[(v_action ->> 'userId')::uuid];
      v_team_id := null;
      v_algorithm := 'direct';
    elsif v_action_type in ('round_robin', 'weighted_round_robin', 'team') then
      v_team_id := (v_action ->> 'teamId')::uuid;
      select coalesce(array_agg(tu.user_id order by tu.created_at, tu.id), array[]::uuid[])
      into v_candidate_ids
      from public.team_users tu where tu.team_id = v_team_id;
      v_algorithm := case when v_action_type = 'weighted_round_robin' then 'weighted_round_robin' else 'round_robin' end;
    else
      v_candidate_ids := array[]::uuid[];
      v_algorithm := 'manual';
    end if;

    if coalesce(array_length(v_candidate_ids, 1), 0) > 0 then
      for v_elig_row in
        select * from public.compute_candidate_eligibility(
          v_lead.organization_id, p_lead_id, v_evaluated_at, v_team_id, v_candidate_ids,
          v_require_territory, coalesce(v_matched_territory_ids, array[]::uuid[]), v_recipient_requirements
        )
      loop
        if v_elig_row.eligible then
          v_eligible := v_eligible || v_elig_row.user_id;
        else
          v_excluded := v_excluded || jsonb_build_object('userId', v_elig_row.user_id, 'reasonCode', v_elig_row.reason_code);
        end if;
      end loop;
    end if;

    if v_action_type = 'direct' then
      if v_eligible @> array[(v_action ->> 'userId')::uuid] then
        v_selected_user_id := (v_action ->> 'userId')::uuid;
      end if;
    elsif coalesce(array_length(v_eligible, 1), 0) > 0 then
      if p_lock_state then
        select * into v_routing_state from public.routing_state
          where organization_id = v_lead.organization_id and team_id = v_team_id and routing_flow_id = v_flow.id
          for update;
      else
        select * into v_routing_state from public.routing_state
          where organization_id = v_lead.organization_id and team_id = v_team_id and routing_flow_id = v_flow.id;
      end if;

      if v_algorithm = 'round_robin' then
        select coalesce(array_agg(tu.user_id order by tu.created_at, tu.id), array[]::uuid[])
        into v_ordered
        from public.team_users tu where tu.team_id = v_team_id and tu.user_id = any(v_eligible);

        if v_routing_state.last_assigned_user_id is null then
          v_selected_user_id := v_ordered[1];
        else
          v_last_index := array_position(v_ordered, v_routing_state.last_assigned_user_id);
          if v_last_index is null then
            v_selected_user_id := v_ordered[1];
          else
            v_selected_user_id := v_ordered[(v_last_index % array_length(v_ordered, 1)) + 1];
          end if;
        end if;
      else
        declare
          v_sequence uuid[] := array[]::uuid[];
          v_uid uuid;
          v_weight int;
          v_position int;
        begin
          foreach v_uid in array v_eligible loop
            select uas.assignment_weight into v_weight from public.user_assignment_settings uas
              where uas.user_id = v_uid and uas.organization_id = v_lead.organization_id;
            for i in 1..greatest(coalesce(v_weight, 1), 0) loop
              v_sequence := v_sequence || v_uid;
            end loop;
          end loop;

          if coalesce(array_length(v_sequence, 1), 0) > 0 then
            v_position := (coalesce(v_routing_state.rotation_cursor, 0) % array_length(v_sequence, 1)) + 1;
            v_selected_user_id := v_sequence[v_position];
          end if;
        end;
      end if;
    end if;
  end if;

  -- Fallback: flow-level default_user_id, then default_team_id (round robin),
  -- each subject to the same eligibility filter, per spec §29.4.
  if v_selected_user_id is null then
    if v_flow.default_user_id is not null then
      for v_elig_row in
        select * from public.compute_candidate_eligibility(
          v_lead.organization_id, p_lead_id, v_evaluated_at, null, array[v_flow.default_user_id],
          false, array[]::uuid[], '[]'::jsonb
        )
      loop
        if v_elig_row.eligible then
          v_selected_user_id := v_flow.default_user_id;
          v_algorithm := 'fallback';
          v_fallback_result := jsonb_build_object('type', 'fallback_user', 'userId', v_flow.default_user_id);
        else
          v_excluded := v_excluded || jsonb_build_object('userId', v_elig_row.user_id, 'reasonCode', v_elig_row.reason_code);
        end if;
      end loop;
    end if;

    if v_selected_user_id is null and v_flow.default_team_id is not null then
      declare
        v_fallback_candidates uuid[];
        v_fallback_eligible uuid[] := array[]::uuid[];
        v_fallback_state record;
        v_fallback_last_index int;
      begin
        select coalesce(array_agg(tu.user_id order by tu.created_at, tu.id), array[]::uuid[])
        into v_fallback_candidates
        from public.team_users tu where tu.team_id = v_flow.default_team_id;

        for v_elig_row in
          select * from public.compute_candidate_eligibility(
            v_lead.organization_id, p_lead_id, v_evaluated_at, v_flow.default_team_id, v_fallback_candidates,
            false, array[]::uuid[], '[]'::jsonb
          )
        loop
          if v_elig_row.eligible then
            v_fallback_eligible := v_fallback_eligible || v_elig_row.user_id;
          else
            v_excluded := v_excluded || jsonb_build_object('userId', v_elig_row.user_id, 'reasonCode', v_elig_row.reason_code);
          end if;
        end loop;

        if coalesce(array_length(v_fallback_eligible, 1), 0) > 0 then
          if p_lock_state then
            select * into v_fallback_state from public.routing_state
              where organization_id = v_lead.organization_id and team_id = v_flow.default_team_id and routing_flow_id = v_flow.id
              for update;
          else
            select * into v_fallback_state from public.routing_state
              where organization_id = v_lead.organization_id and team_id = v_flow.default_team_id and routing_flow_id = v_flow.id;
          end if;

          if v_fallback_state.last_assigned_user_id is null then
            v_selected_user_id := v_fallback_eligible[1];
          else
            v_fallback_last_index := array_position(v_fallback_eligible, v_fallback_state.last_assigned_user_id);
            if v_fallback_last_index is null then
              v_selected_user_id := v_fallback_eligible[1];
            else
              v_selected_user_id := v_fallback_eligible[(v_fallback_last_index % array_length(v_fallback_eligible, 1)) + 1];
            end if;
          end if;

          v_team_id := v_flow.default_team_id;
          v_algorithm := 'fallback';
          v_fallback_result := jsonb_build_object('type', 'fallback_team_round_robin', 'userId', v_selected_user_id);
        end if;
      end;
    end if;
  end if;

  if v_selected_user_id is not null then
    v_outcome := 'assigned';
  else
    v_outcome := 'manual_review';
    if v_matched_rule_id is null then
      v_manual_review_reason := 'no_matching_rule';
    elsif coalesce(array_length(v_eligible, 1), 0) = 0 and jsonb_array_length(v_excluded) > 0 then
      v_manual_review_reason := 'all_users_unavailable';
    else
      v_manual_review_reason := 'no_eligible_user';
    end if;
    if v_algorithm is null then
      v_algorithm := 'manual';
    end if;
  end if;

  return jsonb_build_object(
    'routingFlowId', v_flow.id,
    'routingFlowVersionId', v_flow.current_version_id,
    'rulesEvaluated', v_rules_evaluated,
    'matchedRuleId', v_matched_rule_id,
    'territoryMatches', v_context -> 'matchedTerritoryIds',
    'eligibleUsers', to_jsonb(v_eligible),
    'excludedUsers', v_excluded,
    'assignmentAlgorithm', v_algorithm,
    'selectedUserId', v_selected_user_id,
    'selectedTeamId', v_team_id,
    'fallbackResult', v_fallback_result,
    'outcome', v_outcome,
    'manualReviewReason', v_manual_review_reason,
    'evaluatedAt', v_evaluated_at
  );
end;
$$;

revoke all on function public.compute_routing_decision(uuid, boolean) from public, anon;
grant execute on function public.compute_routing_decision(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- route_lead: the live routing transaction (spec §30's 22-step list).
-- SECURITY DEFINER — callable by `authenticated` for manually-triggered
-- routing (e.g. from the manual review queue), and invoked internally
-- (plain SQL function call, no RPC) by record_lead_submission after
-- creating a lead from the anon-safe intake path. Idempotent: if the lead
-- already has an active assignment, returns it unchanged rather than
-- creating a duplicate — this, plus the partial unique index on
-- assignments(lead_id), is what makes concurrent route_lead calls for the
-- same lead safe (spec §30's "at most one active assignment per lead").
-- ---------------------------------------------------------------------------

create or replace function public.route_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
  v_existing record;
  v_decision jsonb;
  v_assignment public.assignments;
  v_acceptance_minutes int;
begin
  -- Lock the lead row for the duration of this transaction so two
  -- concurrent route_lead(same lead) calls serialize here rather than both
  -- proceeding to independently compute a decision.
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id using errcode = '02000';
  end if;

  select * into v_existing from public.assignments
  where lead_id = p_lead_id and status in ('pending', 'notified', 'viewed');
  if v_existing.id is not null then
    return jsonb_build_object('outcome', 'already_assigned', 'assignment', to_jsonb(v_existing));
  end if;

  v_decision := public.compute_routing_decision(p_lead_id, true);

  if v_decision ->> 'outcome' = 'assigned' then
    select coalesce(rf.acceptance_deadline_minutes, 30) into v_acceptance_minutes
    from public.routing_flows rf where rf.id = (v_decision ->> 'routingFlowId')::uuid;

    begin
      insert into public.assignments (
        organization_id, lead_id, routing_flow_id, routing_flow_version_id, team_id, user_id,
        status, assignment_algorithm, acceptance_deadline_at, explanation
      ) values (
        v_lead.organization_id, p_lead_id,
        (v_decision ->> 'routingFlowId')::uuid, (v_decision ->> 'routingFlowVersionId')::uuid,
        (v_decision ->> 'selectedTeamId')::uuid, (v_decision ->> 'selectedUserId')::uuid,
        'pending', (v_decision ->> 'assignmentAlgorithm')::public.assignment_algorithm,
        now() + make_interval(mins => v_acceptance_minutes), v_decision
      )
      returning * into v_assignment;
    exception when unique_violation then
      -- Another concurrent call won the race after our existence check
      -- above (shouldn't happen given the row lock, but the partial unique
      -- index is the real, unconditional guarantee — see docs/decisions.md).
      select * into v_assignment from public.assignments
      where lead_id = p_lead_id and status in ('pending', 'notified', 'viewed');
      return jsonb_build_object('outcome', 'already_assigned', 'assignment', to_jsonb(v_assignment));
    end;

    update public.leads
    set assigned_team_id = v_assignment.team_id, assigned_user_id = v_assignment.user_id,
        assignment_status = 'assigned'
    where id = p_lead_id;

    if (v_decision ->> 'selectedTeamId') is not null and (v_decision ->> 'assignmentAlgorithm') in ('round_robin', 'fallback') then
      insert into public.routing_state (organization_id, team_id, routing_flow_id, last_assigned_user_id, rotation_cursor)
      values (
        v_lead.organization_id, (v_decision ->> 'selectedTeamId')::uuid, (v_decision ->> 'routingFlowId')::uuid,
        v_assignment.user_id, 1
      )
      on conflict (organization_id, team_id, routing_flow_id)
      do update set last_assigned_user_id = v_assignment.user_id, rotation_cursor = public.routing_state.rotation_cursor + 1;
    elsif (v_decision ->> 'selectedTeamId') is not null and (v_decision ->> 'assignmentAlgorithm') = 'weighted_round_robin' then
      insert into public.routing_state (organization_id, team_id, routing_flow_id, last_assigned_user_id, rotation_cursor)
      values (
        v_lead.organization_id, (v_decision ->> 'selectedTeamId')::uuid, (v_decision ->> 'routingFlowId')::uuid,
        v_assignment.user_id, 1
      )
      on conflict (organization_id, team_id, routing_flow_id)
      do update set last_assigned_user_id = v_assignment.user_id, rotation_cursor = public.routing_state.rotation_cursor + 1;
    end if;

    insert into public.assignment_attempts (
      organization_id, lead_id, assignment_id, routing_rule_version_id,
      eligible_user_ids, excluded, selected_user_id, outcome
    ) values (
      v_lead.organization_id, p_lead_id, v_assignment.id, (v_decision ->> 'matchedRuleId')::uuid,
      coalesce(v_decision -> 'eligibleUsers', '[]'::jsonb), coalesce(v_decision -> 'excludedUsers', '[]'::jsonb),
      v_assignment.user_id, 'assigned'
    );

    insert into public.activities (organization_id, lead_id, activity_type, metadata)
    values (v_lead.organization_id, p_lead_id, 'assignment_created', jsonb_build_object('assignment_id', v_assignment.id));

    return jsonb_build_object('outcome', 'assigned', 'assignment', to_jsonb(v_assignment), 'decision', v_decision);
  else
    update public.leads set assignment_status = 'manual_review' where id = p_lead_id;

    insert into public.manual_review_items (organization_id, lead_id, reason)
    values (v_lead.organization_id, p_lead_id, coalesce(v_decision ->> 'manualReviewReason', 'no_eligible_user')::public.manual_review_reason);

    insert into public.assignment_attempts (
      organization_id, lead_id, routing_rule_version_id, eligible_user_ids, excluded, outcome
    ) values (
      v_lead.organization_id, p_lead_id, (v_decision ->> 'matchedRuleId')::uuid,
      coalesce(v_decision -> 'eligibleUsers', '[]'::jsonb), coalesce(v_decision -> 'excludedUsers', '[]'::jsonb),
      'manual_review'
    );

    insert into public.activities (organization_id, lead_id, activity_type, metadata)
    values (v_lead.organization_id, p_lead_id, 'manual_review_created', jsonb_build_object('reason', v_decision ->> 'manualReviewReason'));

    return jsonb_build_object('outcome', 'manual_review', 'decision', v_decision);
  end if;
end;
$$;

revoke all on function public.route_lead(uuid) from public, anon;
grant execute on function public.route_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- simulate_routing: read-only. Calls the identical compute_routing_decision
-- used by route_lead (p_lock_state = false — no locking, no writes), so
-- simulator/live parity holds by construction rather than by convention
-- (spec §34, §54's release-blocking parity test). Never inserts into
-- leads/assignments/activities/routing_state/manual_review_items.
-- ---------------------------------------------------------------------------

create or replace function public.simulate_routing(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_decision jsonb;
begin
  v_decision := public.compute_routing_decision(p_lead_id, false);
  return v_decision || jsonb_build_object('simulated', true);
end;
$$;

revoke all on function public.simulate_routing(uuid) from public, anon;
grant execute on function public.simulate_routing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_assignment / decline_assignment / expire_assignment: idempotent
-- state transitions, each locking the target assignment row before
-- checking/changing state so a decline and an expiration racing on the same
-- assignment cannot both succeed (spec §32).
-- ---------------------------------------------------------------------------

create or replace function public.accept_assignment(p_assignment_id uuid)
returns public.assignments
language plpgsql
as $$
declare
  v_assignment public.assignments;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id for update;
  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = '02000';
  end if;

  if v_assignment.status = 'accepted' then
    return v_assignment; -- idempotent no-op, spec §32
  end if;

  if v_assignment.status not in ('pending', 'notified', 'viewed') then
    raise exception 'assignment % cannot be accepted from status %', p_assignment_id, v_assignment.status
      using errcode = '23514';
  end if;

  update public.assignments
  set status = 'accepted', responded_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  update public.leads set assignment_status = 'accepted' where id = v_assignment.lead_id;

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_assignment.organization_id, v_assignment.lead_id, 'assignment_accepted', auth.uid(),
    jsonb_build_object('assignment_id', v_assignment.id));

  return v_assignment;
end;
$$;

create or replace function public.decline_assignment(p_assignment_id uuid)
returns public.assignments
language plpgsql
as $$
declare
  v_assignment public.assignments;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id for update;
  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = '02000';
  end if;

  if v_assignment.status = 'declined' then
    return v_assignment; -- idempotent no-op, spec §32
  end if;

  if v_assignment.status not in ('pending', 'notified', 'viewed') then
    raise exception 'assignment % cannot be declined from status %', p_assignment_id, v_assignment.status
      using errcode = '23514';
  end if;

  update public.assignments
  set status = 'declined', responded_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_assignment.organization_id, v_assignment.lead_id, 'assignment_declined', auth.uid(),
    jsonb_build_object('assignment_id', v_assignment.id));

  perform public.reassign_lead(v_assignment.lead_id);

  return v_assignment;
end;
$$;

create or replace function public.expire_assignment(p_assignment_id uuid)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id for update;
  if v_assignment.id is null then
    raise exception 'assignment % not found', p_assignment_id using errcode = '02000';
  end if;

  if v_assignment.status = 'expired' then
    return v_assignment; -- idempotent no-op
  end if;

  if v_assignment.status not in ('pending', 'notified', 'viewed') then
    return v_assignment; -- already resolved (accepted/declined/etc.) — nothing to expire
  end if;

  update public.assignments
  set status = 'expired', responded_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  insert into public.activities (organization_id, lead_id, activity_type, metadata)
  values (v_assignment.organization_id, v_assignment.lead_id, 'assignment_expired',
    jsonb_build_object('assignment_id', v_assignment.id));

  perform public.reassign_lead(v_assignment.lead_id);

  return v_assignment;
end;
$$;

-- ---------------------------------------------------------------------------
-- reassign_lead: re-runs route_lead for a lead whose active assignment was
-- declined/expired. The previously-declined/expired user is automatically
-- excluded by compute_candidate_eligibility's PREVIOUSLY_DECLINED check
-- (it looks at all of the lead's past assignments, not just the current
-- one), so this is not a special code path — it is simply route_lead
-- called again, per docs/routing-engine.md §5. If every recipient has now
-- been exhausted, route_lead's own manual-review fallback (via
-- compute_routing_decision) naturally takes over.
-- ---------------------------------------------------------------------------

create or replace function public.reassign_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.route_lead(p_lead_id);
end;
$$;

revoke all on function public.accept_assignment(uuid) from public, anon;
grant execute on function public.accept_assignment(uuid) to authenticated;
revoke all on function public.decline_assignment(uuid) from public, anon;
grant execute on function public.decline_assignment(uuid) to authenticated;
revoke all on function public.expire_assignment(uuid) from public, anon;
grant execute on function public.expire_assignment(uuid) to authenticated;
revoke all on function public.reassign_lead(uuid) from public, anon;
grant execute on function public.reassign_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_lead_submission (Milestone 3): extended to call route_lead
-- internally immediately after creating a lead. This is a direct SQL
-- function call, not a client RPC — the `anon` role never needs (and never
-- gets) execute on route_lead itself; it only reaches it transitively
-- through this already-anon-callable function, inside the same
-- transaction. A routing failure here fails the whole submission rather
-- than silently creating a lead with no routing attempt and no visibility
-- into why — see docs/decisions.md.
-- ---------------------------------------------------------------------------

create or replace function public.record_lead_submission(
  p_lead_source_id uuid,
  p_idempotency_key text,
  p_external_submission_id text,
  p_raw_payload jsonb,
  p_mapped_payload jsonb,
  p_validation_errors jsonb,
  p_submission_status text,
  p_test_mode boolean,
  p_lead_fields jsonb,
  p_lead_duplicate_status text,
  p_custom_values jsonb,
  p_duplicate_of_lead_id uuid,
  p_match_basis text,
  p_duplicate_action text
)
returns table (submission_log_id uuid, lead_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status public.lead_source_status;
  v_log_id uuid;
  v_lead_id uuid;
  v_existing_log_id uuid;
  v_existing_lead_id uuid;
begin
  select ls.organization_id, ls.status into v_org_id, v_status
  from public.lead_sources ls
  where ls.id = p_lead_source_id;

  if v_org_id is null then
    raise exception 'unknown lead source' using errcode = '28000';
  end if;

  if v_status <> 'active' then
    raise exception 'lead source is not active' using errcode = '28000';
  end if;

  if p_idempotency_key is not null then
    select sl.id, sl.resulting_lead_id into v_existing_log_id, v_existing_lead_id
    from public.submission_logs sl
    where sl.lead_source_id = p_lead_source_id
      and sl.idempotency_key = p_idempotency_key;

    if v_existing_log_id is not null then
      return query select v_existing_log_id, v_existing_lead_id;
      return;
    end if;
  end if;

  insert into public.submission_logs (
    organization_id, lead_source_id, raw_payload, mapped_payload,
    validation_errors, status, idempotency_key, external_submission_id, test_mode
  ) values (
    v_org_id, p_lead_source_id, p_raw_payload, coalesce(p_mapped_payload, '{}'::jsonb),
    coalesce(p_validation_errors, '[]'::jsonb), p_submission_status::public.submission_log_status,
    p_idempotency_key, p_external_submission_id, p_test_mode
  )
  returning id into v_log_id;

  if p_test_mode or p_lead_fields is null then
    return query select v_log_id, null::uuid;
    return;
  end if;

  insert into public.leads (
    organization_id, first_name, last_name, full_name, email, phone,
    street_address, unit_number, neighborhood, city, county, state_province,
    postal_code, country, lead_source_id, external_submission_id, message,
    campaign, medium, referrer, landing_page,
    email_consent, sms_consent, privacy_consent, consent_text, consent_timestamp, consent_ip,
    duplicate_status
  ) values (
    v_org_id,
    p_lead_fields->>'first_name', p_lead_fields->>'last_name', p_lead_fields->>'full_name',
    p_lead_fields->>'email', p_lead_fields->>'phone',
    p_lead_fields->>'street_address', p_lead_fields->>'unit_number', p_lead_fields->>'neighborhood',
    p_lead_fields->>'city', p_lead_fields->>'county', p_lead_fields->>'state_province',
    p_lead_fields->>'postal_code', p_lead_fields->>'country',
    p_lead_source_id, p_external_submission_id, p_lead_fields->>'message',
    p_lead_fields->>'campaign', p_lead_fields->>'medium', p_lead_fields->>'referrer',
    p_lead_fields->>'landing_page',
    coalesce((p_lead_fields->>'email_consent')::boolean, false),
    coalesce((p_lead_fields->>'sms_consent')::boolean, false),
    coalesce((p_lead_fields->>'privacy_consent')::boolean, false),
    p_lead_fields->>'consent_text',
    nullif(p_lead_fields->>'consent_timestamp', '')::timestamptz,
    nullif(p_lead_fields->>'consent_ip', '')::inet,
    coalesce(p_lead_duplicate_status, 'unique')::public.lead_duplicate_status
  )
  returning id into v_lead_id;

  if p_custom_values is not null then
    insert into public.lead_custom_values (organization_id, lead_id, variable_definition_id, value)
    select v_org_id, v_lead_id, (elem->>'variable_definition_id')::uuid, elem->'value'
    from jsonb_array_elements(p_custom_values) as elem;
  end if;

  if p_duplicate_of_lead_id is not null then
    insert into public.lead_duplicates (organization_id, lead_id, duplicate_of_lead_id, match_basis, action_taken)
    values (
      v_org_id, v_lead_id, p_duplicate_of_lead_id,
      p_match_basis::public.lead_duplicate_match_basis,
      p_duplicate_action::public.lead_duplicate_action
    );
  end if;

  update public.submission_logs set resulting_lead_id = v_lead_id, updated_at = now() where id = v_log_id;

  -- Milestone 5: route the newly created lead within this same transaction.
  perform public.route_lead(v_lead_id);

  return query select v_log_id, v_lead_id;
end;
$$;

revoke all on function public.record_lead_submission(
  uuid, text, text, jsonb, jsonb, jsonb, text, boolean, jsonb, text, jsonb, uuid, text, text
) from public;
grant execute on function public.record_lead_submission(
  uuid, text, text, jsonb, jsonb, jsonb, text, boolean, jsonb, text, jsonb, uuid, text, text
) to anon, authenticated;
