"use client";

import { useActionState } from "react";
import {
  createCustomVariableFormAction,
  type CreateCustomVariableFormState,
} from "@/modules/custom-variables/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function CreateCustomVariableForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createCustomVariableFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateCustomVariableFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Name" htmlFor="name">
        <Input id="name" type="text" name="name" required />
      </Field>
      <Field label="Internal key" htmlFor="internalKey">
        <Input
          id="internalKey"
          type="text"
          name="internalKey"
          required
          pattern="[a-z0-9_]+"
        />
      </Field>
      <Field label="Field type" htmlFor="fieldType">
        <Select id="fieldType" name="fieldType" defaultValue="text">
          <option value="text">Text</option>
          <option value="long_text">Long text</option>
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="boolean">Boolean</option>
          <option value="date">Date</option>
          <option value="datetime">Date and time</option>
          <option value="single_select">Single select</option>
          <option value="multi_select">Multi select</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="url">URL</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Create custom variable
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
