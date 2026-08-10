-- Milestone 7: Lead Interface. See docs/database-schema.md §8/§12/§19,
-- docs/phase1-product-spec.md §36-39/§45-46, docs/permissions-matrix.md
-- "Leads" section.
--
-- Gives every role the lightweight lead-visibility surface the spec calls
-- for: lead list/detail, org-configurable lead statuses, notes, a routing
-- health dashboard, and an audit log view. Explicitly NOT a CRM — no deal
-- boards, forecasting, or conversation timelines.

-- ---------------------------------------------------------------------------
-- Widen activity_type for this milestone's events (mirrors Milestone 6's
-- pattern of widening ahead of the functions that use the new values).
-- ---------------------------------------------------------------------------

alter type public.activity_type add value if not exists 'status_changed';
alter type public.activity_type add value if not exists 'note_added';

-- ---------------------------------------------------------------------------
-- lead_status_definitions / lead_status_history (spec §37)
-- ---------------------------------------------------------------------------

create table public.lead_status_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  sort_order int not null default 0,
  is_default_set boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_status_definitions_org_key_unique unique (organization_id, key)
);

comment on table public.lead_status_definitions is
  'Per docs/database-schema.md §8 / spec §37. Seeded with 9 default '
  'statuses per organization (see seed_default_lead_statuses below);
  organizations may rename/reorder/disable/add beyond the defaults.';

create index lead_status_definitions_organization_id_idx on public.lead_status_definitions (organization_id);

create trigger lead_status_definitions_set_updated_at
  before update on public.lead_status_definitions
  for each row
  execute function public.set_updated_at();

create table public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.lead_status_history is
  'Per docs/database-schema.md §8. Insert-only, written exclusively by '
  'update_lead_status() below.';

create index lead_status_history_lead_id_idx on public.lead_status_history (lead_id, created_at);
create index lead_status_history_organization_id_idx on public.lead_status_history (organization_id);

-- ---------------------------------------------------------------------------
-- notes (spec §38)
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is
  'Per docs/database-schema.md §12 / spec §38. Visible to anyone who can '
  'see the lead (docs/permissions-matrix.md) — private notes are not '
  'required in Phase 1.';

create index notes_lead_id_idx on public.notes (lead_id, created_at);
create index notes_organization_id_idx on public.notes (organization_id);

create trigger notes_set_updated_at
  before update on public.notes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- routing_health_metrics (spec §45)
-- ---------------------------------------------------------------------------

create table public.routing_health_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  leads_received int not null default 0,
  leads_assigned int not null default 0,
  leads_awaiting_acceptance int not null default 0,
  assignments_expired int not null default 0,
  leads_reassigned int not null default 0,
  leads_in_manual_review int not null default 0,
  no_matching_rule_count int not null default 0,
  no_eligible_user_count int not null default 0,
  users_at_capacity_count int not null default 0,
  unavailable_users_count int not null default 0,
  territories_without_users_count int not null default 0,
  territory_conflicts_count int not null default 0,
  crm_sync_failures int not null default 0,
  webhook_failures int not null default 0,
  median_routing_time_ms numeric,
  median_acceptance_time_ms numeric,
  assignment_success_rate numeric,
  manual_routing_rate numeric,
  created_at timestamptz not null default now()
);

comment on table public.routing_health_metrics is
  'Per docs/database-schema.md §19. A historical snapshot row, refreshed '
  'by a best-effort Cron job (ADR-046) — the live dashboard computes '
  'current numbers on demand via compute_routing_health() rather than '
  'depending on this table ever having run, mirroring Milestone 4''s '
  'on-demand conflict detection (ADR-036).';

create index routing_health_metrics_organization_bucket_idx
  on public.routing_health_metrics (organization_id, bucket_start desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.lead_status_definitions enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.notes enable row level security;
alter table public.routing_health_metrics enable row level security;

create policy lead_status_definitions_select_active_member
  on public.lead_status_definitions for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy lead_status_definitions_write_org_admin
  on public.lead_status_definitions for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- lead_status_history / notes: same read scope as leads/activities — an
-- agent sees history/notes only for leads assigned to them, a team_manager
-- for permitted-team leads, org_admin for all (docs/permissions-matrix.md).
create policy lead_status_history_select_scoped
  on public.lead_status_history for select to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = lead_status_history.lead_id
        and (
          (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
          or l.assigned_user_id = (select auth.uid())
        )
    )
  );

-- update_lead_status() (below) is a plain, non-SECURITY-DEFINER function
-- that inserts this history row as a side effect of a scoped status
-- change — it needs its own INSERT policy for the same reason
-- activities_insert_active_member exists alongside activities_select_scoped.
create policy lead_status_history_insert_scoped
  on public.lead_status_history for insert to authenticated
  with check (
    changed_by_user_id = (select auth.uid())
    and (
      public.is_org_admin(organization_id)
      or exists (
        select 1 from public.leads l
        where l.id = lead_status_history.lead_id
          and (
            (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
            or l.assigned_user_id = (select auth.uid())
          )
      )
    )
  );

create policy notes_select_scoped
  on public.notes for select to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = notes.lead_id
        and (
          (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
          or l.assigned_user_id = (select auth.uid())
        )
    )
  );

-- Adding a note requires the same "can see this lead" scope, plus the note
-- must be authored as the real caller (mirrors audit_logs' actor check).
create policy notes_insert_scoped
  on public.notes for insert to authenticated
  with check (
    author_user_id = (select auth.uid())
    and (
      public.is_org_admin(organization_id)
      or exists (
        select 1 from public.leads l
        where l.id = notes.lead_id
          and (
            (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
            or l.assigned_user_id = (select auth.uid())
          )
      )
    )
  );

create policy routing_health_metrics_select_active_member
  on public.routing_health_metrics for select to authenticated
  using (public.is_active_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- seed_default_lead_statuses: the 9 defaults from spec §37. Called for
-- every new organization (bootstrap_organization, extended below) and
-- backfilled here for any organization created before this migration.
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_lead_statuses(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_status_definitions (organization_id, key, label, sort_order, is_default_set)
  values
    (p_organization_id, 'new', 'New', 1, true),
    (p_organization_id, 'assigned', 'Assigned', 2, true),
    (p_organization_id, 'accepted', 'Accepted', 3, true),
    (p_organization_id, 'contact_attempted', 'Contact Attempted', 4, true),
    (p_organization_id, 'contacted', 'Contacted', 5, true),
    (p_organization_id, 'qualified', 'Qualified', 6, true),
    (p_organization_id, 'unqualified', 'Unqualified', 7, true),
    (p_organization_id, 'converted', 'Converted', 8, true),
    (p_organization_id, 'lost', 'Lost', 9, true)
  on conflict (organization_id, key) do nothing;
end;
$$;

revoke all on function public.seed_default_lead_statuses(uuid) from public, anon, authenticated;

insert into public.lead_status_definitions (organization_id, key, label, sort_order, is_default_set)
select o.id, s.key, s.label, s.sort_order, true
from public.organizations o
cross join (values
  ('new', 'New', 1), ('assigned', 'Assigned', 2), ('accepted', 'Accepted', 3),
  ('contact_attempted', 'Contact Attempted', 4), ('contacted', 'Contacted', 5),
  ('qualified', 'Qualified', 6), ('unqualified', 'Unqualified', 7),
  ('converted', 'Converted', 8), ('lost', 'Lost', 9)
) as s(key, label, sort_order)
on conflict (organization_id, key) do nothing;

create or replace function public.bootstrap_organization(org_name text, org_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.organizations (name, slug)
  values (org_name, org_slug)
  returning * into new_org;

  insert into public.organization_users (organization_id, user_id, role, status, activated_at)
  values (new_org.id, caller_id, 'org_admin', 'active', now());

  perform public.seed_default_lead_statuses(new_org.id);

  return new_org;
end;
$$;

revoke all on function public.bootstrap_organization(text, text) from public;
grant execute on function public.bootstrap_organization(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_lead_status: validates the target status belongs to the org's
-- active status set, records history, and enforces the same scoped
-- authorization as leads_update_scoped (org_admin / permitted team_manager
-- / the lead's own assignee — docs/permissions-matrix.md "Update lead
-- status"). Not SECURITY DEFINER: relies on leads_update_scoped RLS to
-- gate the actual UPDATE, matching accept_assignment/decline_assignment's
-- pattern from Milestone 5/6 of leaning on RLS for plain state changes.
-- ---------------------------------------------------------------------------

create or replace function public.update_lead_status(p_lead_id uuid, p_new_status text)
returns public.leads
language plpgsql
as $$
declare
  v_lead public.leads;
  v_old_status text;
  v_status_valid boolean;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'lead % not found' , p_lead_id using errcode = '02000';
  end if;

  select exists (
    select 1 from public.lead_status_definitions
    where organization_id = v_lead.organization_id and key = p_new_status and active = true
  ) into v_status_valid;

  if not v_status_valid then
    raise exception 'status % is not a valid active status for this organization', p_new_status
      using errcode = '23514';
  end if;

  if v_lead.lead_status = p_new_status then
    return v_lead; -- idempotent no-op
  end if;

  v_old_status := v_lead.lead_status;

  update public.leads set lead_status = p_new_status where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_status_history (organization_id, lead_id, from_status, to_status, changed_by_user_id)
  values (v_lead.organization_id, p_lead_id, v_old_status, p_new_status, auth.uid());

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_lead.organization_id, p_lead_id, 'status_changed', auth.uid(),
    jsonb_build_object('to_status', p_new_status));

  return v_lead;
end;
$$;

revoke all on function public.update_lead_status(uuid, text) from public, anon;
grant execute on function public.update_lead_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_note: inserts the note and its activity-timeline entry atomically.
-- Not SECURITY DEFINER — relies on notes_insert_scoped RLS (which already
-- requires author_user_id = auth.uid()) for authorization, and on
-- activities_insert_active_member for the activity row.
-- ---------------------------------------------------------------------------

create or replace function public.add_note(p_lead_id uuid, p_content text)
returns public.notes
language plpgsql
as $$
declare
  v_lead public.leads;
  v_note public.notes;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id using errcode = '02000';
  end if;

  insert into public.notes (organization_id, lead_id, author_user_id, content)
  values (v_lead.organization_id, p_lead_id, auth.uid(), p_content)
  returning * into v_note;

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_lead.organization_id, p_lead_id, 'note_added', auth.uid(), jsonb_build_object('note_id', v_note.id));

  return v_note;
end;
$$;

revoke all on function public.add_note(uuid, text) from public, anon;
grant execute on function public.add_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_routing_health: the 18 metrics from spec §45, computed live over
-- [p_bucket_start, p_bucket_end) rather than depending on a Cron job
-- having ever populated routing_health_metrics — same "compute on demand"
-- precedent as Milestone 4's conflict detection (ADR-036). Two metrics
-- (crm_sync_failures, webhook_failures) always report 0: their source
-- tables (integration_logs, webhook_deliveries) don't exist until
-- Milestone 8. "Territories without active users" and "territory
-- conflicts" use a simpler structural approximation here than the full
-- detection logic in modules/territories/conflict-detection.ts (which
-- remains the source of truth for the Territories admin page) — see
-- docs/decisions.md.
-- ---------------------------------------------------------------------------

create or replace function public.compute_routing_health(
  p_organization_id uuid, p_bucket_start timestamptz, p_bucket_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'leadsReceived', (
      select count(*) from public.leads
      where organization_id = p_organization_id and created_at >= p_bucket_start and created_at < p_bucket_end
    ),
    'leadsAssigned', (
      select count(*) from public.assignments
      where organization_id = p_organization_id and created_at >= p_bucket_start and created_at < p_bucket_end
        and status <> 'cancelled'
    ),
    'leadsAwaitingAcceptance', (
      select count(*) from public.assignments
      where organization_id = p_organization_id and status in ('pending', 'notified', 'viewed')
    ),
    'assignmentsExpired', (
      select count(*) from public.assignments
      where organization_id = p_organization_id and status = 'expired'
        and updated_at >= p_bucket_start and updated_at < p_bucket_end
    ),
    'leadsReassigned', (
      select count(distinct lead_id) from (
        select lead_id, count(*) as n from public.assignments
        where organization_id = p_organization_id and created_at >= p_bucket_start and created_at < p_bucket_end
        group by lead_id having count(*) > 1
      ) reassigned
    ),
    'leadsInManualReview', (
      select count(*) from public.manual_review_items
      where organization_id = p_organization_id and status = 'open'
    ),
    'noMatchingRuleCount', (
      select count(*) from public.manual_review_items
      where organization_id = p_organization_id and reason = 'no_matching_rule'
        and created_at >= p_bucket_start and created_at < p_bucket_end
    ),
    'noEligibleUserCount', (
      select count(*) from public.manual_review_items
      where organization_id = p_organization_id and reason = 'no_eligible_user'
        and created_at >= p_bucket_start and created_at < p_bucket_end
    ),
    'usersAtCapacityCount', (
      select count(*) from public.user_assignment_settings uas
      where uas.organization_id = p_organization_id
        and (
          (uas.daily_lead_limit > 0 and (
            select count(*) from public.assignments a
            where a.user_id = uas.user_id and a.organization_id = p_organization_id
              and a.created_at >= date_trunc('day', now()) and a.status <> 'cancelled'
          ) >= uas.daily_lead_limit)
          or (uas.active_lead_limit > 0 and (
            select count(*) from public.assignments a
            where a.user_id = uas.user_id and a.organization_id = p_organization_id
              and a.status in ('pending', 'notified', 'viewed', 'accepted')
          ) >= uas.active_lead_limit)
        )
    ),
    'unavailableUsersCount', (
      select count(*) from public.user_availability
      where organization_id = p_organization_id and availability_status <> 'available'
    ),
    'territoriesWithoutUsersCount', (
      select count(*) from public.territories t
      where t.organization_id = p_organization_id and t.status = 'active'
        and not exists (select 1 from public.territory_users tu where tu.territory_id = t.id)
        and not exists (select 1 from public.territory_teams tt where tt.territory_id = t.id)
    ),
    'territoryConflictsCount', (
      select count(*) from (
        select territory_type, country, state_province, county, city, neighborhood, postal_code, count(*) as n
        from public.territories
        where organization_id = p_organization_id and status = 'active'
        group by territory_type, country, state_province, county, city, neighborhood, postal_code
        having count(*) > 1
      ) dupes
    ),
    'crmSyncFailures', 0,
    'webhookFailures', 0,
    'medianRoutingTimeMs', (
      select percentile_cont(0.5) within group (order by extract(epoch from (a.created_at - l.created_at)) * 1000)
      from public.assignments a
      join public.leads l on l.id = a.lead_id
      where a.organization_id = p_organization_id and a.created_at >= p_bucket_start and a.created_at < p_bucket_end
    ),
    'medianAcceptanceTimeMs', (
      select percentile_cont(0.5) within group (order by extract(epoch from (a.responded_at - a.created_at)) * 1000)
      from public.assignments a
      where a.organization_id = p_organization_id and a.status = 'accepted'
        and a.created_at >= p_bucket_start and a.created_at < p_bucket_end
    ),
    'assignmentSuccessRate', (
      select case when count(*) = 0 then null else
        (count(*) filter (where outcome = 'assigned'))::numeric / count(*)
      end
      from public.assignment_attempts
      where organization_id = p_organization_id and created_at >= p_bucket_start and created_at < p_bucket_end
    ),
    'manualRoutingRate', (
      select case when count(*) = 0 then null else
        (count(*) filter (where assignment_algorithm = 'manual'))::numeric / count(*)
      end
      from public.assignments
      where organization_id = p_organization_id and created_at >= p_bucket_start and created_at < p_bucket_end
        and status <> 'cancelled'
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.compute_routing_health(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.compute_routing_health(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- refresh_routing_health_metrics: snapshots compute_routing_health() into
-- routing_health_metrics for every organization, for historical trending.
-- Best-effort Cron-scheduled (only when pg_cron is available — mirrors
-- Milestone 6's is_cron_available() guard); the live dashboard never
-- depends on this having run.
-- ---------------------------------------------------------------------------

create or replace function public.refresh_routing_health_metrics()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
  v_bucket_start timestamptz := date_trunc('hour', now());
  v_bucket_end timestamptz := v_bucket_start + interval '1 hour';
  v_metrics jsonb;
  v_count int := 0;
begin
  for v_org in select id from public.organizations where status = 'active' loop
    v_metrics := public.compute_routing_health(v_org.id, v_bucket_start, v_bucket_end);
    insert into public.routing_health_metrics (
      organization_id, bucket_start, bucket_end, leads_received, leads_assigned,
      leads_awaiting_acceptance, assignments_expired, leads_reassigned, leads_in_manual_review,
      no_matching_rule_count, no_eligible_user_count, users_at_capacity_count, unavailable_users_count,
      territories_without_users_count, territory_conflicts_count, crm_sync_failures, webhook_failures,
      median_routing_time_ms, median_acceptance_time_ms, assignment_success_rate, manual_routing_rate
    ) values (
      v_org.id, v_bucket_start, v_bucket_end,
      (v_metrics->>'leadsReceived')::int, (v_metrics->>'leadsAssigned')::int,
      (v_metrics->>'leadsAwaitingAcceptance')::int, (v_metrics->>'assignmentsExpired')::int,
      (v_metrics->>'leadsReassigned')::int, (v_metrics->>'leadsInManualReview')::int,
      (v_metrics->>'noMatchingRuleCount')::int, (v_metrics->>'noEligibleUserCount')::int,
      (v_metrics->>'usersAtCapacityCount')::int, (v_metrics->>'unavailableUsersCount')::int,
      (v_metrics->>'territoriesWithoutUsersCount')::int, (v_metrics->>'territoryConflictsCount')::int,
      (v_metrics->>'crmSyncFailures')::int, (v_metrics->>'webhookFailures')::int,
      (v_metrics->>'medianRoutingTimeMs')::numeric, (v_metrics->>'medianAcceptanceTimeMs')::numeric,
      (v_metrics->>'assignmentSuccessRate')::numeric, (v_metrics->>'manualRoutingRate')::numeric
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.refresh_routing_health_metrics() from public, anon, authenticated;
grant execute on function public.refresh_routing_health_metrics() to service_role;

do $$
begin
  if public.is_cron_available() then
    perform cron.schedule(
      'refresh-routing-health-metrics', '*/5 * * * *',
      $cron$select public.refresh_routing_health_metrics();$cron$
    );
  end if;
exception when others then
  raise notice 'Could not schedule refresh-routing-health-metrics: %', sqlerrm;
end;
$$;
