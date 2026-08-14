"use client";

import { useActionState } from "react";
import {
  createOrganizationFormAction,
  type CreateOrganizationFormState,
} from "./actions";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

const initialState: CreateOrganizationFormState = {};

export function CreateOrganizationForm() {
  const [state, formAction, isPending] = useActionState(
    createOrganizationFormAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Organization name" htmlFor="org-name">
        <Input id="org-name" name="name" type="text" required maxLength={200} />
      </Field>
      <Field label="Slug" htmlFor="org-slug">
        <Input
          id="org-slug"
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="acme-co"
        />
      </Field>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Creating..." : "Create organization"}
      </Button>
    </form>
  );
}
