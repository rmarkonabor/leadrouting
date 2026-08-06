"use client";

import { useActionState } from "react";
import {
  createCustomVariableFormAction,
  type CreateCustomVariableFormState,
} from "@/modules/custom-variables/actions";

export function CreateCustomVariableForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createCustomVariableFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateCustomVariableFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Name
        <input type="text" name="name" required />
      </label>
      <label>
        Internal key
        <input type="text" name="internalKey" required pattern="[a-z0-9_]+" />
      </label>
      <label>
        Field type
        <select name="fieldType" defaultValue="text">
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
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Create custom variable
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
