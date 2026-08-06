"use client";

import { useActionState } from "react";
import {
  createLeadSourceFormAction,
  type CreateLeadSourceFormState,
} from "@/modules/lead-sources/actions";

export function CreateLeadSourceForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createLeadSourceFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateLeadSourceFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Name
        <input type="text" name="name" required />
      </label>
      <label>
        Source type
        <select name="sourceType" defaultValue="api">
          <option value="api">API</option>
          <option value="webhook">Webhook</option>
          <option value="external_form">External form</option>
          <option value="manual">Manual</option>
          <option value="csv">CSV</option>
          <option value="crm">CRM</option>
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Create lead source
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.plaintextToken ? (
        <p>
          Source token (shown once — copy it now): <code>{state.plaintextToken}</code>
        </p>
      ) : null}
    </form>
  );
}
