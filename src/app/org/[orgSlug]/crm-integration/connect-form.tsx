"use client";

import { useActionState } from "react";
import {
  connectIntegrationFormAction,
  type ConnectIntegrationFormState,
} from "@/modules/integrations/actions";

export function ConnectForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = connectIntegrationFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    ConnectIntegrationFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Provider
        <input type="text" name="provider" required placeholder="e.g. generic_http" />
      </label>
      <label>
        CRM base URL
        <input
          type="url"
          name="baseUrl"
          required
          placeholder="https://api.example-crm.com/v1"
        />
      </label>
      <label>
        API key / access token
        <input type="password" name="apiKey" required />
      </label>
      <button type="submit" disabled={pending}>
        Connect
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
