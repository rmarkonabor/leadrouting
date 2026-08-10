"use client";

import { useActionState } from "react";
import {
  manuallyAssignFromReviewFormAction,
  type ManuallyAssignFormState,
} from "@/modules/manual-review/actions";

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
    <form action={formAction}>
      <label>
        User ID to assign
        <input type="text" name="userId" required placeholder="user UUID" />
      </label>
      <label>
        Team (optional)
        <select name="teamId" defaultValue="">
          <option value="">(none)</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Manually assign
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
