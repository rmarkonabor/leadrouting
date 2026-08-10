-- Milestone 6: Assignment Accountability. See docs/database-schema.md §13/§15,
-- docs/background-processing.md, docs/phase1-product-spec.md §31-35/§39-41.
--
-- Closes the assignment lifecycle loop: notifications (in-app + queued
-- email), viewed tracking, expiration/reassignment driven by Cron, manual
-- assignment/reassignment, and a complete activity timeline. See
-- docs/decisions.md ADR-041 through ADR-045 for the architecture rationale
-- (why pgmq/pg_cron are best-effort-enabled here the same way PostGIS was in
-- Milestone 4, why email sending itself is deferred behind a swappable
-- adapter, and the idempotency/retry/dead-letter design).

-- ---------------------------------------------------------------------------
-- pgmq / pg_cron: attempted best-effort, never allowed to abort this
-- migration — mirrors Milestone 4's is_postgis_available() pattern. Neither
-- extension is installable in this project's local sandbox Postgres (no
-- apt package), but both ship on real Supabase projects. Application code
-- checks these live capability functions rather than assuming availability.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pgmq with schema extensions;
exception when others then
  raise notice 'pgmq extension could not be enabled: %', sqlerrm;
end;
$$;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception when others then
  raise notice 'pg_cron extension could not be enabled: %', sqlerrm;
end;
$$;

create or replace function public.is_queue_available()
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_extension where extname = 'pgmq');
$$;

create or replace function public.is_cron_available()
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_extension where extname = 'pg_cron');
$$;

comment on function public.is_queue_available() is
  'Live capability check for pgmq — enqueue calls no-op (return null) when '
  'false rather than failing the caller''s transaction, per docs/decisions.md.';
comment on function public.is_cron_available() is
  'Live capability check for pg_cron. Cron job registration below is '
  'skipped when false (e.g. this local sandbox); on a real Supabase '
  'project both extensions are present and this migration schedules the '
  'jobs immediately.';

grant execute on function public.is_queue_available() to authenticated;
grant execute on function public.is_cron_available() to authenticated;

do $$
begin
  if public.is_queue_available() then
    perform pgmq.create('assignment_notifications');
  end if;
exception when others then
  raise notice 'Could not create assignment_notifications queue: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Widen activity_type (Milestone 5's comment anticipated this exact
-- migration). Only the events this milestone actually produces are added;
-- the remaining spec §39 events belong to later milestones (notes, status
-- changes, CRM/webhook sync) that don't exist yet.
-- ---------------------------------------------------------------------------

alter type public.activity_type add value 'assignment_notified';
alter type public.activity_type add value 'assignment_viewed';
alter type public.activity_type add value 'manual_assignment';
alter type public.activity_type add value 'manual_reassignment';
alter type public.activity_type add value 'manual_review_resolved';

-- ---------------------------------------------------------------------------
-- notifications (in-app)
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  lead_id uuid references public.leads(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per docs/database-schema.md §13 / spec §40. Written by the assignment '
  'notification queue consumer, never directly by a client.';

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notifications_organization_id_idx on public.notifications (organization_id);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update_own_read_state
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT policy for authenticated/anon: rows are written exclusively by
-- the SECURITY DEFINER notification-recording function below, called by the
-- (service-role) queue consumer.

-- ---------------------------------------------------------------------------
-- integration_jobs: generic dedupe-keyed queue/job ledger (also backs
-- Milestone 8's crm_sync/outbound_webhooks queues later, reusing this same
-- table rather than a per-queue table per docs/background-processing.md).
-- ---------------------------------------------------------------------------

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_name text not null,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'retrying', 'cancelled', 'dead_letter')),
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  dedupe_key text not null,
  queue_msg_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_jobs_dedupe_unique unique (queue_name, dedupe_key)
);

comment on table public.integration_jobs is
  'Per docs/database-schema.md §15 / docs/background-processing.md §4. The '
  'unique (queue_name, dedupe_key) constraint is the actual idempotency '
  'guarantee — a redelivered queue message re-inserts nothing (ON CONFLICT '
  'DO NOTHING) and the consumer treats an already-completed job as a no-op.';

create index integration_jobs_organization_id_idx on public.integration_jobs (organization_id);
create index integration_jobs_status_idx on public.integration_jobs (queue_name, status);

create trigger integration_jobs_set_updated_at
  before update on public.integration_jobs
  for each row
  execute function public.set_updated_at();

alter table public.integration_jobs enable row level security;

-- Visibility only (ops/debugging) — org_admin, read-only. All writes go
-- through SECURITY DEFINER functions, never a direct client insert/update.
create policy integration_jobs_select_org_admin
  on public.integration_jobs for select to authenticated
  using (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- enqueue_assignment_notification: the single producer for every
-- notification event this milestone generates (new assignment, expiration
-- warning, expired, manual review). Idempotent by construction — the
-- dedupe key ensures a redelivered/duplicate call is a silent no-op rather
-- than a duplicate notification (docs/background-processing.md §4).
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_assignment_notification(
  p_organization_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_msg_id bigint;
begin
  insert into public.integration_jobs (organization_id, queue_name, job_type, payload, dedupe_key)
  values (p_organization_id, 'assignment_notifications', p_event_type, p_payload, p_dedupe_key)
  on conflict (queue_name, dedupe_key) do nothing
  returning id into v_job_id;

  -- Already enqueued (or already processed) for this exact event — nothing
  -- more to do. This is the idempotency guarantee, not just an optimization.
  if v_job_id is null then
    return null;
  end if;

  if public.is_queue_available() then
    select pgmq.send('assignment_notifications', jsonb_build_object('job_id', v_job_id, 'event_type', p_event_type) || p_payload)
      into v_msg_id;
    update public.integration_jobs set queue_msg_id = v_msg_id where id = v_job_id;
  end if;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_assignment_notification(uuid, text, text, jsonb) from public, anon;
grant execute on function public.enqueue_assignment_notification(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_assignment_viewed: fired when the assignee opens their notification
-- link (spec §31 step 5). Idempotent — viewing twice doesn't error or
-- change anything the second time. Only the assignee or an org_admin may
-- call it (mirrors accept_assignment/decline_assignment's implicit RLS-free
-- authorization pattern, since these are plain — not SECURITY DEFINER —
-- functions relying on auth.uid()).
-- ---------------------------------------------------------------------------

create or replace function public.mark_assignment_viewed(p_assignment_id uuid)
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

  if v_assignment.user_id is distinct from auth.uid() and not public.is_org_admin(v_assignment.organization_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if v_assignment.viewed_at is not null then
    return v_assignment; -- idempotent no-op
  end if;

  if v_assignment.status not in ('pending', 'notified', 'viewed') then
    return v_assignment; -- already resolved, viewing is moot
  end if;

  update public.assignments
  set viewed_at = now(), status = case when status in ('pending', 'notified') then 'viewed' else status end
  where id = p_assignment_id
  returning * into v_assignment;

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_assignment.organization_id, v_assignment.lead_id, 'assignment_viewed', auth.uid(),
    jsonb_build_object('assignment_id', v_assignment.id));

  return v_assignment;
end;
$$;

revoke all on function public.mark_assignment_viewed(uuid) from public, anon;
grant execute on function public.mark_assignment_viewed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- route_lead: extended to enqueue a 'new_lead_assignment' notification on
-- every fresh assignment (initial routing AND reassignment — reassign_lead
-- is just route_lead called again, so this one call site covers both), and
-- a 'lead_manual_review' notification when routing falls through to
-- manual review. Identical body to the Milestone 5 migration otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.route_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads;
  v_existing public.assignments;
  v_decision jsonb;
  v_assignment public.assignments;
  v_acceptance_minutes int;
  v_manual_review_item public.manual_review_items;
begin
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

  if (v_decision ->> 'outcome') = 'assigned' then
    select coalesce(rf.acceptance_deadline_minutes, 30) into v_acceptance_minutes
    from public.routing_flows rf where rf.id = (v_decision ->> 'routingFlowId')::uuid;
    v_acceptance_minutes := coalesce(v_acceptance_minutes, 30);

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
      select * into v_assignment from public.assignments
      where lead_id = p_lead_id and status in ('pending', 'notified', 'viewed');
      return jsonb_build_object('outcome', 'already_assigned', 'assignment', to_jsonb(v_assignment));
    end;

    update public.leads
    set assigned_team_id = v_assignment.team_id, assigned_user_id = v_assignment.user_id,
        assignment_status = 'assigned'
    where id = p_lead_id;

    if (v_decision ->> 'selectedTeamId') is not null and (v_decision ->> 'assignmentAlgorithm') = 'round_robin' then
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

    perform public.enqueue_assignment_notification(
      v_lead.organization_id, 'new_lead_assignment',
      v_assignment.id::text || ':new_lead_assignment',
      jsonb_build_object('assignment_id', v_assignment.id, 'lead_id', p_lead_id, 'user_id', v_assignment.user_id)
    );

    return jsonb_build_object('outcome', 'assigned', 'assignment', to_jsonb(v_assignment), 'decision', v_decision);
  else
    update public.leads set assignment_status = 'manual_review' where id = p_lead_id;

    insert into public.manual_review_items (organization_id, lead_id, reason)
    values (v_lead.organization_id, p_lead_id, coalesce(v_decision ->> 'manualReviewReason', 'no_eligible_user')::public.manual_review_reason)
    returning * into v_manual_review_item;

    insert into public.assignment_attempts (
      organization_id, lead_id, routing_rule_version_id, eligible_user_ids, excluded, outcome
    ) values (
      v_lead.organization_id, p_lead_id, (v_decision ->> 'matchedRuleId')::uuid,
      coalesce(v_decision -> 'eligibleUsers', '[]'::jsonb), coalesce(v_decision -> 'excludedUsers', '[]'::jsonb),
      'manual_review'
    );

    insert into public.activities (organization_id, lead_id, activity_type, metadata)
    values (v_lead.organization_id, p_lead_id, 'manual_review_created', jsonb_build_object('reason', v_decision ->> 'manualReviewReason'));

    perform public.enqueue_assignment_notification(
      v_lead.organization_id, 'lead_manual_review',
      v_manual_review_item.id::text || ':lead_manual_review',
      jsonb_build_object('manual_review_item_id', v_manual_review_item.id, 'lead_id', p_lead_id)
    );

    return jsonb_build_object('outcome', 'manual_review', 'decision', v_decision);
  end if;
end;
$$;

revoke all on function public.route_lead(uuid) from public, anon;
grant execute on function public.route_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- expire_assignment: extended to enqueue an 'assignment_expired' notification
-- to the original assignee before handing off to reassign_lead. Identical
-- body to Milestone 5 otherwise.
-- ---------------------------------------------------------------------------

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

  perform public.enqueue_assignment_notification(
    v_assignment.organization_id, 'assignment_expired',
    v_assignment.id::text || ':assignment_expired',
    jsonb_build_object('assignment_id', v_assignment.id, 'lead_id', v_assignment.lead_id, 'user_id', v_assignment.user_id)
  );

  perform public.reassign_lead(v_assignment.lead_id);

  return v_assignment;
end;
$$;

revoke all on function public.expire_assignment(uuid) from public, anon;
grant execute on function public.expire_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- run_expire_assignments / run_send_expiration_warnings: the two Cron-driven
-- sweeps (docs/background-processing.md §2). Both are naturally idempotent
-- — each iteration's WHERE clause only matches rows still in the state that
-- needs action, so running the sweep twice back-to-back (or the Cron
-- schedule overlapping a slow run) processes the second run's matches as
-- zero, not a duplicate action.
-- ---------------------------------------------------------------------------

create or replace function public.run_expire_assignments()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select id from public.assignments
    where status in ('pending', 'notified', 'viewed')
      and acceptance_deadline_at is not null
      and acceptance_deadline_at < now()
  loop
    perform public.expire_assignment(v_row.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.run_send_expiration_warnings(p_warn_at_fraction numeric default 0.8)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_job_id uuid;
  v_count int := 0;
begin
  for v_row in
    select a.id, a.organization_id, a.lead_id, a.user_id
    from public.assignments a
    where a.status in ('pending', 'notified', 'viewed')
      and a.acceptance_deadline_at is not null
      and now() >= a.created_at + (p_warn_at_fraction * (a.acceptance_deadline_at - a.created_at))
      and now() < a.acceptance_deadline_at
  loop
    v_job_id := public.enqueue_assignment_notification(
      v_row.organization_id, 'assignment_expiration_warning',
      v_row.id::text || ':assignment_expiration_warning',
      jsonb_build_object('assignment_id', v_row.id, 'lead_id', v_row.lead_id, 'user_id', v_row.user_id)
    );
    if v_job_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.run_expire_assignments() from public, anon, authenticated;
revoke all on function public.run_send_expiration_warnings(numeric) from public, anon, authenticated;
grant execute on function public.run_expire_assignments() to service_role;
grant execute on function public.run_send_expiration_warnings(numeric) to service_role;

-- ---------------------------------------------------------------------------
-- manually_assign_lead / manually_reassign_lead: administrator override
-- (spec §35 items 8-9). org_admin or a permitted team_manager only. Cancels
-- any existing active assignment (status 'cancelled', which — unlike
-- 'declined'/'expired' — is NOT treated as a PREVIOUSLY_DECLINED signal by
-- eligibility filtering, since an admin override isn't a decline) and
-- creates a new one with assignment_algorithm = 'manual'. Resolves any open
-- manual_review_items for the lead.
-- ---------------------------------------------------------------------------

create or replace function public.manually_assign_or_reassign_lead(
  p_lead_id uuid, p_user_id uuid, p_team_id uuid, p_activity_type public.activity_type
)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads;
  v_assignment public.assignments;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'lead % not found', p_lead_id using errcode = '02000';
  end if;

  if not (public.is_org_admin(v_lead.organization_id)
      or (p_team_id is not null and public.is_permitted_team_manager(p_team_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.assignments
  set status = 'cancelled', responded_at = now()
  where lead_id = p_lead_id and status in ('pending', 'notified', 'viewed');

  insert into public.assignments (
    organization_id, lead_id, team_id, user_id, status, assignment_algorithm, explanation
  ) values (
    v_lead.organization_id, p_lead_id, p_team_id, p_user_id, 'pending', 'manual',
    jsonb_build_object('outcome', 'assigned', 'assignmentAlgorithm', 'manual', 'manual', true)
  )
  returning * into v_assignment;

  update public.leads
  set assigned_team_id = p_team_id, assigned_user_id = p_user_id, assignment_status = 'assigned'
  where id = p_lead_id;

  update public.manual_review_items
  set status = 'resolved', resolved_by_user_id = auth.uid(), resolved_at = now()
  where lead_id = p_lead_id and status = 'open';

  insert into public.assignment_attempts (
    organization_id, lead_id, assignment_id, eligible_user_ids, excluded, selected_user_id, outcome
  ) values (
    v_lead.organization_id, p_lead_id, v_assignment.id, '[]'::jsonb, '[]'::jsonb, p_user_id, 'assigned'
  );

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_lead.organization_id, p_lead_id, p_activity_type, auth.uid(),
    jsonb_build_object('assignment_id', v_assignment.id, 'user_id', p_user_id));

  perform public.enqueue_assignment_notification(
    v_lead.organization_id, 'new_lead_assignment',
    v_assignment.id::text || ':new_lead_assignment',
    jsonb_build_object('assignment_id', v_assignment.id, 'lead_id', p_lead_id, 'user_id', p_user_id)
  );

  return v_assignment;
end;
$$;

create or replace function public.manually_reassign_lead(p_lead_id uuid, p_user_id uuid, p_team_id uuid)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.manually_assign_or_reassign_lead(p_lead_id, p_user_id, p_team_id, 'manual_reassignment');
end;
$$;

create or replace function public.manually_assign_lead(p_lead_id uuid, p_user_id uuid, p_team_id uuid)
returns public.assignments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.manually_assign_or_reassign_lead(p_lead_id, p_user_id, p_team_id, 'manual_assignment');
end;
$$;

revoke all on function public.manually_assign_or_reassign_lead(uuid, uuid, uuid, public.activity_type) from public, anon, authenticated;
revoke all on function public.manually_assign_lead(uuid, uuid, uuid) from public, anon;
revoke all on function public.manually_reassign_lead(uuid, uuid, uuid) from public, anon;
grant execute on function public.manually_assign_or_reassign_lead(uuid, uuid, uuid, public.activity_type) to service_role;
grant execute on function public.manually_assign_lead(uuid, uuid, uuid) to authenticated;
grant execute on function public.manually_reassign_lead(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Queue wrapper functions: pgmq's own functions live in the `pgmq` schema
-- and are not meant to be exposed directly over PostgREST. These narrow
-- wrappers are the only surface the TypeScript notification consumer uses,
-- callable only by service_role (the consumer runs as an internal system
-- process, not on behalf of any single end user request).
-- ---------------------------------------------------------------------------

create or replace function public.dequeue_assignment_notifications(p_batch_size int default 10, p_visibility_timeout_seconds int default 30)
returns table (msg_id bigint, payload jsonb, read_ct int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_queue_available() then
    return;
  end if;
  return query
    select m.msg_id, m.message as payload, m.read_ct
    from pgmq.read('assignment_notifications', p_visibility_timeout_seconds, p_batch_size) m;
end;
$$;

create or replace function public.ack_assignment_notification(p_msg_id bigint, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.integration_jobs set status = 'completed' where id = p_job_id;
  if public.is_queue_available() then
    perform pgmq.delete('assignment_notifications', p_msg_id);
  end if;
end;
$$;

create or replace function public.fail_assignment_notification(p_msg_id bigint, p_job_id uuid, p_error text, p_max_attempts int default 5)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
begin
  update public.integration_jobs
  set attempt_count = attempt_count + 1, last_error = p_error,
      status = case when attempt_count + 1 >= p_max_attempts then 'dead_letter' else 'retrying' end,
      next_retry_at = now() + make_interval(mins => least(60, power(2, attempt_count + 1)::int))
  where id = p_job_id
  returning attempt_count into v_attempts;

  if public.is_queue_available() then
    if v_attempts >= p_max_attempts then
      perform pgmq.archive('assignment_notifications', p_msg_id);
    else
      -- Leave the message in place; pgmq's own visibility timeout makes it
      -- reappear to dequeue_assignment_notifications after the window
      -- passes, which is the redelivery/retry mechanism itself.
      null;
    end if;
  end if;
end;
$$;

revoke all on function public.dequeue_assignment_notifications(int, int) from public, anon, authenticated;
revoke all on function public.ack_assignment_notification(bigint, uuid) from public, anon, authenticated;
revoke all on function public.fail_assignment_notification(bigint, uuid, text, int) from public, anon, authenticated;
grant execute on function public.dequeue_assignment_notifications(int, int) to service_role;
grant execute on function public.ack_assignment_notification(bigint, uuid) to service_role;
grant execute on function public.fail_assignment_notification(bigint, uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- record_notification: writes the in-app notification row. Called by the
-- TypeScript consumer (service_role) after successfully composing a
-- notification's title/body from the job payload — kept as a narrow
-- SECURITY DEFINER insert rather than a direct table grant so the
-- consumer's service-role client can't be used to write arbitrary
-- notification rows outside this shape.
-- ---------------------------------------------------------------------------

create or replace function public.record_notification(
  p_organization_id uuid, p_user_id uuid, p_event_type text,
  p_lead_id uuid, p_assignment_id uuid, p_title text, p_body text
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.notifications;
begin
  insert into public.notifications (organization_id, user_id, event_type, lead_id, assignment_id, title, body)
  values (p_organization_id, p_user_id, p_event_type, p_lead_id, p_assignment_id, p_title, p_body)
  returning * into v_notification;
  return v_notification;
end;
$$;

revoke all on function public.record_notification(uuid, uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_notification(uuid, uuid, text, uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Cron scheduling: only registered when pg_cron is actually available
-- (never on this local sandbox). `app.settings.app_url` / `app.settings.
-- cron_secret` must be configured on the real Supabase project (Database
-- Settings > Custom Postgres Config, or via `alter database ... set ...`)
-- before these HTTP-calling jobs can reach the app's internal queue-
-- processing route — see docs/decisions.md.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net extension could not be enabled: %', sqlerrm;
end;
$$;

do $$
begin
  if public.is_cron_available() then
    perform cron.schedule('expire-assignments', '* * * * *', $cron$select public.run_expire_assignments();$cron$);
    perform cron.schedule('send-expiration-warnings', '* * * * *', $cron$select public.run_send_expiration_warnings();$cron$);

    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule(
        'process-assignment-notifications',
        '* * * * *',
        $cron$
        select net.http_post(
          url => current_setting('app.settings.app_url', true) || '/api/internal/queue/process-assignment-notifications',
          headers => jsonb_build_object('x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body => '{}'::jsonb
        )
        where current_setting('app.settings.app_url', true) is not null
          and current_setting('app.settings.cron_secret', true) is not null;
        $cron$
      );
    end if;
  end if;
exception when others then
  raise notice 'Could not schedule Milestone 6 cron jobs: %', sqlerrm;
end;
$$;
