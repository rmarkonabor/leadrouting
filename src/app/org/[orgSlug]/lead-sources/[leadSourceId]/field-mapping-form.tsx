"use client";

import { useActionState } from "react";
import {
  upsertFieldMappingFormAction,
  type UpsertFieldMappingFormState,
} from "@/modules/field-mapping/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function FieldMappingForm({
  orgSlug,
  leadSourceId,
}: {
  orgSlug: string;
  leadSourceId: string;
}) {
  const boundAction = upsertFieldMappingFormAction.bind(null, orgSlug, leadSourceId);
  const [state, formAction, pending] = useActionState<
    UpsertFieldMappingFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Source field name" htmlFor="sourceFieldName">
        <Input id="sourceFieldName" type="text" name="sourceFieldName" required />
      </Field>
      <Field label="Destination type" htmlFor="destinationType">
        <Select id="destinationType" name="destinationType" defaultValue="default_field">
          <option value="default_field">Default lead field</option>
          <option value="custom_variable">Custom variable</option>
          <option value="ignored">Ignored</option>
        </Select>
      </Field>
      <Field label="Destination field" htmlFor="destinationField">
        <Input id="destinationField" type="text" name="destinationField" />
      </Field>
      <Field label="Data type" htmlFor="dataType">
        <Input id="dataType" type="text" name="dataType" defaultValue="text" required />
      </Field>
      <Field label="Transformation" htmlFor="transformation">
        <Select id="transformation" name="transformation" defaultValue="">
          <option value="">None</option>
          <option value="trim">Trim whitespace</option>
          <option value="lowercase">Lowercase</option>
          <option value="uppercase">Uppercase</option>
          <option value="normalize_email">Normalize email</option>
          <option value="normalize_phone">Normalize phone</option>
          <option value="parse_number">Parse number</option>
          <option value="parse_currency">Parse currency</option>
          <option value="to_boolean">Convert to boolean</option>
          <option value="split_full_name">Split full name</option>
          <option value="join_values">Join values</option>
          <option value="replace_values">Replace values</option>
          <option value="apply_default">Apply default value</option>
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
