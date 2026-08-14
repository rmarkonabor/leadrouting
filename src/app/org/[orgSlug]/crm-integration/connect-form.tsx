"use client";

import { useActionState } from "react";
import {
  connectIntegrationFormAction,
  type ConnectIntegrationFormState,
} from "@/modules/integrations/actions";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

export function ConnectForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = connectIntegrationFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    ConnectIntegrationFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Provider" htmlFor="provider">
        <Input
          id="provider"
          type="text"
          name="provider"
          required
          placeholder="e.g. generic_http"
        />
      </Field>
      <Field label="CRM base URL" htmlFor="baseUrl">
        <Input
          id="baseUrl"
          type="url"
          name="baseUrl"
          required
          placeholder="https://api.example-crm.com/v1"
        />
      </Field>
      <Field label="API key / access token" htmlFor="apiKey">
        <Input id="apiKey" type="password" name="apiKey" required />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Connect
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
