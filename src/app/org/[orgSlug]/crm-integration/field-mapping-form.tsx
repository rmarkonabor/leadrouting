"use client";

import { useActionState } from "react";
import {
  upsertFieldMappingFormAction,
  type UpsertFieldMappingFormState,
} from "@/modules/integrations/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function FieldMappingForm({
  orgSlug,
  connectionId,
}: {
  orgSlug: string;
  connectionId: string;
}) {
  const boundAction = upsertFieldMappingFormAction.bind(null, orgSlug, connectionId);
  const [state, formAction, pending] = useActionState<
    UpsertFieldMappingFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Source field" htmlFor="sourceField">
        <Input
          id="sourceField"
          type="text"
          name="sourceField"
          required
          placeholder="email or custom:budget_range"
        />
      </Field>
      <Field label="CRM field" htmlFor="crmField">
        <Input id="crmField" type="text" name="crmField" required />
      </Field>
      <Field label="Transformation (optional)" htmlFor="transformation">
        <Select id="transformation" name="transformation" defaultValue="">
          <option value="">None</option>
          <option value="trim">Trim</option>
          <option value="lowercase">Lowercase</option>
          <option value="uppercase">Uppercase</option>
          <option value="normalize_email">Normalize email</option>
          <option value="normalize_phone">Normalize phone</option>
          <option value="parse_number">Parse number</option>
          <option value="parse_currency">Parse currency</option>
          <option value="to_boolean">To boolean</option>
          <option value="split_full_name">Split full name</option>
          <option value="join_values">Join values</option>
          <option value="replace_values">Replace values</option>
          <option value="apply_default">Apply default</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save mapping
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-danger-text sm:col-span-2">{state.error}</p>
      ) : null}
    </form>
  );
}
