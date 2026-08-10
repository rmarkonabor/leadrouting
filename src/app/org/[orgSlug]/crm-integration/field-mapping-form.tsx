"use client";

import { useActionState } from "react";
import {
  upsertFieldMappingFormAction,
  type UpsertFieldMappingFormState,
} from "@/modules/integrations/actions";

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
    <form action={formAction}>
      <label>
        Source field
        <input
          type="text"
          name="sourceField"
          required
          placeholder="email or custom:budget_range"
        />
      </label>
      <label>
        CRM field
        <input type="text" name="crmField" required />
      </label>
      <label>
        Transformation (optional)
        <select name="transformation" defaultValue="">
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
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Save mapping
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
