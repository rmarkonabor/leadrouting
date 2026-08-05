"use client";

import { useActionState } from "react";
import {
  createOrganizationFormAction,
  type CreateOrganizationFormState,
} from "./actions";

const initialState: CreateOrganizationFormState = {};

export function CreateOrganizationForm() {
  const [state, formAction, isPending] = useActionState(
    createOrganizationFormAction,
    initialState,
  );

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="org-name">Organization name</label>
        <input id="org-name" name="name" type="text" required maxLength={200} />
      </div>
      <div>
        <label htmlFor="org-slug">Slug</label>
        <input
          id="org-slug"
          name="slug"
          type="text"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="acme-co"
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={isPending}>
        {isPending ? "Creating..." : "Create organization"}
      </button>
    </form>
  );
}
