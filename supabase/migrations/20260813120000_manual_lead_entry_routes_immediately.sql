-- Fixes a real gap found while building the missing "New lead" UI: manual
-- lead entry (spec §17's "manual" source type, `modules/leads/manual-lead-
-- entry.ts`) has never actually triggered routing. Unlike the token-based
-- intake path — where `record_lead_submission` calls `route_lead` inside
-- the same transaction immediately after creating the lead — the manual
-- entry path only ever did a plain `insert into leads`. No trigger and no
-- other code path calls `route_lead` for it, so every manually-entered
-- lead has been silently left `assignment_status = 'unassigned'` forever:
-- no assignment, no notification, nothing for a recipient to see.
--
-- Fix: `create_manual_lead`, a single-transaction function mirroring
-- `record_lead_submission`'s pattern — insert the lead, then call
-- `route_lead` on it before returning — so CLAUDE.md rule 21 ("critical
-- assignment operations run as single-transaction database functions,
-- never as multi-request client-orchestrated flows") isn't violated by
-- having the TypeScript layer insert first and RPC a second, separate
-- `route_lead` call afterward.
--
-- Authorization is checked inside the function itself (org_admin, or a
-- team_manager for at least one team in the target organization — the
-- same rule `modules/leads/manual-lead-entry.ts` already enforces in
-- TypeScript before calling this). This is not redundant: the function is
-- granted to `authenticated` broadly (so any signed-in user's client could
-- call it directly with an arbitrary `p_organization_id`), so without this
-- check a user could create — and immediately route — leads in an
-- organization they don't belong to. This is the same class of gap
-- `20260813100000_validate_manual_assignment_org_membership.sql` fixed for
-- manual assignment; per CLAUDE.md rule 8, authorization here is enforced
-- at both layers (TypeScript and this function), never one alone.

create or replace function public.create_manual_lead(
  p_organization_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_street_address text,
  p_unit_number text,
  p_neighborhood text,
  p_city text,
  p_county text,
  p_state_province text,
  p_postal_code text,
  p_country text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_routing_result jsonb;
begin
  if not (
    public.is_org_admin(p_organization_id)
    or exists (
      select 1 from public.team_users tu
      join public.teams t on t.id = tu.team_id
      where t.organization_id = p_organization_id
        and tu.user_id = auth.uid()
        and tu.is_manager = true
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.leads (
    organization_id, first_name, last_name, email, phone,
    street_address, unit_number, neighborhood, city, county,
    state_province, postal_code, country, message
  ) values (
    p_organization_id, p_first_name, p_last_name, p_email, p_phone,
    p_street_address, p_unit_number, p_neighborhood, p_city, p_county,
    p_state_province, p_postal_code, p_country, p_message
  )
  returning id into v_lead_id;

  v_routing_result := public.route_lead(v_lead_id);

  return jsonb_build_object('leadId', v_lead_id, 'routing', v_routing_result);
end;
$$;

revoke all on function public.create_manual_lead(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_manual_lead(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;
