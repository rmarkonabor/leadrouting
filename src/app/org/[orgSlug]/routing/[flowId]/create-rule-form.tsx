"use client";

import { useActionState } from "react";
import {
  createRoutingRuleFormAction,
  type CreateRoutingRuleFormState,
} from "@/modules/routing/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

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
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input id="name" type="text" name="name" required />
        </Field>
        <Field label="Priority (lower = evaluated first)" htmlFor="priority">
          <Input id="priority" type="number" name="priority" defaultValue={100} min={1} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-muted">
          Condition (optional — leave blank to match every lead)
        </legend>
        <Field label="Lead field" htmlFor="conditionField">
          <Select id="conditionField" name="conditionField" defaultValue="">
            <option value="">(none — unconditional rule)</option>
            <option value="country">Country</option>
            <option value="state_province">State / Province</option>
            <option value="city">City</option>
            <option value="postal_code">Postal code</option>
            <option value="campaign">Campaign</option>
            <option value="lead_source_id">Lead source</option>
          </Select>
        </Field>
        <Field label="Equals value" htmlFor="conditionValue">
          <Input id="conditionValue" type="text" name="conditionValue" />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-muted">Action</legend>
        <Field label="Type" htmlFor="actionType">
          <Select id="actionType" name="actionType" defaultValue="round_robin">
            <option value="direct">Direct assignment (specific user)</option>
            <option value="round_robin">Team round robin</option>
            <option value="weighted_round_robin">Team weighted round robin</option>
            <option value="manual_review">Send to manual review</option>
          </Select>
        </Field>
        <Field label="Team" htmlFor="teamId">
          <Select id="teamId" name="teamId" defaultValue="">
            <option value="">(none)</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label='Direct-assignment user ID (for the "Direct assignment" action only)'
          htmlFor="userId"
        >
          <Input id="userId" type="text" name="userId" />
        </Field>
      </fieldset>

      <Button type="submit" disabled={pending} className="self-start">
        Add rule
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
