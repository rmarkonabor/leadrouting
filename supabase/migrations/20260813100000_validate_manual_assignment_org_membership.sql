-- Fixes a release-blocking bug found during the pre-pilot production
-- readiness audit: `manually_assign_or_reassign_lead` never validated that
-- the target `user_id` (or `team_id`, when provided) is actually an active
-- member of the lead's own organization. An `org_admin` (or a permitted
-- `team_manager`, for the team_id branch) could pass any UUID at all —
-- including a real user or team belonging to a *different* organization,
-- or a UUID that doesn't correspond to any user/team — and the function
-- would still create the assignment, update `leads.assigned_user_id`, and
-- fire `enqueue_assignment_notification` targeting that user_id.
--
-- Impact: this is a genuine cross-tenant exposure vector, not merely a
-- data-integrity nicety. `leads`/`assignments` row-level security still
-- protects the *lead's own data* from the wrong-org user (their RLS
-- membership check requires `organization_users.organization_id =
-- leads.organization_id`, which they don't have), but the notification
-- content itself (title/body describing the lead, built by
-- `NotificationContentResolver`/`process-assignment-notifications`) would
-- still be generated and delivered directly to that foreign user, which
-- RLS does nothing to stop since it's a targeted insert, not a read the
-- foreign user issues themselves.
--
-- Fix: `manually_assign_or_reassign_lead` now raises before doing anything
-- else if `p_user_id` is not an active member of `v_lead.organization_id`,
-- or if `p_team_id` is provided and does not belong to
-- `v_lead.organization_id`. This applies to both `manually_assign_lead`
-- and `manually_reassign_lead`, which both call this same function.

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

  if not exists (
    select 1 from public.organization_users
    where organization_id = v_lead.organization_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'user % is not an active member of this organization', p_user_id
      using errcode = '22023';
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams
    where id = p_team_id and organization_id = v_lead.organization_id
  ) then
    raise exception 'team % does not belong to this organization', p_team_id
      using errcode = '22023';
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

revoke all on function public.manually_assign_or_reassign_lead(uuid, uuid, uuid, public.activity_type) from public, anon, authenticated;
grant execute on function public.manually_assign_or_reassign_lead(uuid, uuid, uuid, public.activity_type) to service_role;
