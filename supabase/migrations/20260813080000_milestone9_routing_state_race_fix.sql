-- Milestone 9: fixes a genuine round-robin race condition surfaced by the
-- concurrency review's higher-parallelism re-run of the release-blocking
-- routing tests (docs/phase1-product-spec.md §54: "concurrent round robin
-- requests cannot corrupt rotation state"). See docs/decisions.md ADR-056.
--
-- Bug: `compute_routing_decision`'s round-robin/weighted-round-robin and
-- team-fallback branches did `select ... from routing_state ... for update`
-- to read+lock the rotation cursor. When no `routing_state` row exists yet
-- for a given (organization, team, flow) — i.e. the very first routing
-- decision ever made for that team/flow — `SELECT ... FOR UPDATE` against a
-- query that matches zero rows takes no lock at all, because there is no
-- row to lock. Multiple concurrent `route_lead` calls landing on that same
-- unlocked "no row yet" state therefore all independently conclude
-- `last_assigned_user_id is null` and all select the same first candidate,
-- rather than serializing on the very first assignment. This is invisible
-- at low concurrency (a fresh team/flow rarely receives simultaneous first
-- requests) but reproduces reliably under this milestone's higher-
-- parallelism test (60 leads routed genuinely concurrently against a fresh
-- 5-agent round robin produced a 13/12/12/12/11 split instead of an exact
-- 12/12/12/12/12 split).
--
-- Fix: before the `for update` read, `insert ... on conflict do nothing` a
-- zeroed `routing_state` row for that (organization, team, flow). Postgres
-- serializes concurrent inserts targeting the same conflict key (the second
-- INSERT blocks until the first commits, then sees the row and no-ops), so
-- by the time any caller reaches the following `select ... for update`, the
-- row is guaranteed to exist and the lock behaves as originally intended
-- for every subsequent call, including the very first one. This only
-- changes behavior when `p_lock_state` is true (i.e. never for
-- `simulate_routing`, which continues to take no lock and write nothing —
-- unchanged from ADR-038).

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
        -- Ensure the row exists before locking it — see this migration's
        -- header comment. `on conflict do nothing` serializes concurrent
        -- first-ever-assignment callers on the insert itself, so the
        -- following `for update` always locks a real row.
        insert into public.routing_state (organization_id, team_id, routing_flow_id)
        values (v_lead.organization_id, v_team_id, v_flow.id)
        on conflict (organization_id, team_id, routing_flow_id) do nothing;

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
            -- Same fix as the primary round-robin branch above.
            insert into public.routing_state (organization_id, team_id, routing_flow_id)
            values (v_lead.organization_id, v_flow.default_team_id, v_flow.id)
            on conflict (organization_id, team_id, routing_flow_id) do nothing;

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
