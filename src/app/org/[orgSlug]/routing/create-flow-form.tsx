"use client";

import { useActionState } from "react";
import {
  createRoutingFlowFormAction,
  type CreateRoutingFlowFormState,
} from "@/modules/routing/actions";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

export function CreateRoutingFlowForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createRoutingFlowFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateRoutingFlowFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Name" htmlFor="name">
        <Input id="name" type="text" name="name" required />
      </Field>
      <Field label="Acceptance deadline (minutes)" htmlFor="acceptanceDeadlineMinutes">
        <Input
          id="acceptanceDeadlineMinutes"
          type="number"
          name="acceptanceDeadlineMinutes"
          defaultValue={30}
          min={1}
        />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Create draft flow
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
