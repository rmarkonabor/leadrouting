"use client";

import { useActionState } from "react";
import {
  manuallyAssignFromReviewFormAction,
  type ManuallyAssignFormState,
} from "@/modules/manual-review/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function ManualAssignForm({
  orgSlug,
  leadId,
  teams,
}: {
  orgSlug: string;
  leadId: string;
  teams: Array<{ id: string; name: string }>;
}) {
  const boundAction = manuallyAssignFromReviewFormAction.bind(null, orgSlug, leadId);
  const [state, formAction, pending] = useActionState<ManuallyAssignFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <Field label="User ID to assign" htmlFor={`userId-${leadId}`}>
        <Input
          id={`userId-${leadId}`}
          type="text"
          name="userId"
          required
          placeholder="user UUID"
        />
      </Field>
      <Field label="Team (optional)" htmlFor={`teamId-${leadId}`}>
        <Select id={`teamId-${leadId}`} name="teamId" defaultValue="">
          <option value="">(none)</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        Manually assign
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
