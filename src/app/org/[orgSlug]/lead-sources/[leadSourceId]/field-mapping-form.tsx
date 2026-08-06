"use client";

import { useActionState } from "react";
import {
  upsertFieldMappingFormAction,
  type UpsertFieldMappingFormState,
} from "@/modules/field-mapping/actions";

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
    <form action={formAction}>
      <label>
        Source field name
        <input type="text" name="sourceFieldName" required />
      </label>
      <label>
        Destination type
        <select name="destinationType" defaultValue="default_field">
          <option value="default_field">Default lead field</option>
          <option value="custom_variable">Custom variable</option>
          <option value="ignored">Ignored</option>
        </select>
      </label>
      <label>
        Destination field
        <input type="text" name="destinationField" />
      </label>
      <label>
        Data type
        <input type="text" name="dataType" defaultValue="text" required />
      </label>
      <label>
        Transformation
        <select name="transformation" defaultValue="">
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
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Save mapping
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
