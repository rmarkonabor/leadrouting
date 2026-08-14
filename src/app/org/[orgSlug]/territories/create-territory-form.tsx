"use client";

import { useActionState } from "react";
import {
  createTerritoryFormAction,
  type CreateTerritoryFormState,
} from "@/modules/territories/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function CreateTerritoryForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createTerritoryFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<CreateTerritoryFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Name" htmlFor="name">
        <Input id="name" type="text" name="name" required />
      </Field>
      <Field label="Territory type" htmlFor="territoryType">
        <Select id="territoryType" name="territoryType" defaultValue="country">
          <option value="country">Country</option>
          <option value="state_province">State / Province</option>
          <option value="county">County</option>
          <option value="city">City</option>
          <option value="neighborhood">Neighborhood</option>
          <option value="postal_code">Postal code</option>
        </Select>
      </Field>
      <Field
        label="Value (country/state/city/postal code, matching the selected type)"
        htmlFor="value"
      >
        <Input id="value" type="text" name="value" required />
      </Field>
      <Field label="Priority (lower number = higher precedence)" htmlFor="priority">
        <Input id="priority" type="number" name="priority" defaultValue={100} min={1} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Create territory
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
