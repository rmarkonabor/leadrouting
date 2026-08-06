"use client";

import { useActionState } from "react";
import {
  createRoutingRuleFormAction,
  type CreateRoutingRuleFormState,
} from "@/modules/routing/actions";

export function CreateRoutingRuleForm({
  orgSlug,
  flowId,
  teams,
}: {
  orgSlug: string;
  flowId: string;
  teams: Array<{ id: string; name: string }>;
}) {
  const boundAction = createRoutingRuleFormAction.bind(null, orgSlug, flowId);
  const [state, formAction, pending] = useActionState<
    CreateRoutingRuleFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Name
        <input type="text" name="name" required />
      </label>
      <label>
        Priority (lower = evaluated first)
        <input type="number" name="priority" defaultValue={100} min={1} />
      </label>

      <fieldset>
        <legend>Condition (optional — leave blank to match every lead)</legend>
        <label>
          Lead field
          <select name="conditionField" defaultValue="">
            <option value="">(none — unconditional rule)</option>
            <option value="country">Country</option>
            <option value="state_province">State / Province</option>
            <option value="city">City</option>
            <option value="postal_code">Postal code</option>
            <option value="campaign">Campaign</option>
            <option value="lead_source_id">Lead source</option>
          </select>
        </label>
        <label>
          Equals value
          <input type="text" name="conditionValue" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Action</legend>
        <label>
          Type
          <select name="actionType" defaultValue="round_robin">
            <option value="direct">Direct assignment (specific user)</option>
            <option value="round_robin">Team round robin</option>
            <option value="weighted_round_robin">Team weighted round robin</option>
            <option value="manual_review">Send to manual review</option>
          </select>
        </label>
        <label>
          Team
          <select name="teamId" defaultValue="">
            <option value="">(none)</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direct-assignment user ID (for the &quot;Direct assignment&quot; action only)
          <input type="text" name="userId" />
        </label>
      </fieldset>

      <button type="submit" disabled={pending}>
        Add rule
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
