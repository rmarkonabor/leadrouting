"use client";

import { useActionState } from "react";
import {
  createTerritoryFormAction,
  type CreateTerritoryFormState,
} from "@/modules/territories/actions";

export function CreateTerritoryForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTerritoryFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<CreateTerritoryFormState, FormData>(
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
        Territory type
        <select name="territoryType" defaultValue="country">
          <option value="country">Country</option>
          <option value="state_province">State / Province</option>
          <option value="county">County</option>
          <option value="city">City</option>
          <option value="neighborhood">Neighborhood</option>
          <option value="postal_code">Postal code</option>
        </select>
      </label>
      <label>
        Value (country/state/city/postal code, matching the selected type)
        <input type="text" name="value" required />
      </label>
      <label>
        Priority (lower number = higher precedence)
        <input type="number" name="priority" defaultValue={100} min={1} />
      </label>
      <button type="submit" disabled={pending}>
        Create territory
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
