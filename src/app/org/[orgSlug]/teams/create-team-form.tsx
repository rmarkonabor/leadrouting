"use client";

import { useActionState } from "react";
import { createTeamFormAction, type CreateTeamFormState } from "@/modules/teams/actions";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

export function CreateTeamForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTeamFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<CreateTeamFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Name" htmlFor="name">
        <Input id="name" type="text" name="name" required />
      </Field>
      <Field label="Description" htmlFor="description">
        <Input id="description" type="text" name="description" />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Create team
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
