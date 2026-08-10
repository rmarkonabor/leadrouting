"use client";

import { useActionState } from "react";
import {
  createRoutingFlowFormAction,
  type CreateRoutingFlowFormState,
} from "@/modules/routing/actions";

export function CreateRoutingFlowForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createRoutingFlowFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateRoutingFlowFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Name
        <input type="text" name="name" required />
      </label>
      <label>
        Acceptance deadline (minutes)
        <input type="number" name="acceptanceDeadlineMinutes" defaultValue={30} min={1} />
      </label>
      <button type="submit" disabled={pending}>
        Create draft flow
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
