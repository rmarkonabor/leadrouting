"use client";

import { useActionState } from "react";
import { createTeamFormAction, type CreateTeamFormState } from "@/modules/teams/actions";

export function CreateTeamForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTeamFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<CreateTeamFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction}>
      <label>
        Name
        <input type="text" name="name" required />
      </label>
      <label>
        Description
        <input type="text" name="description" />
      </label>
      <button type="submit" disabled={pending}>
        Create team
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
