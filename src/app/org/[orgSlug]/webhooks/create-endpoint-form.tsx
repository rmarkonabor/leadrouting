"use client";

import { useActionState } from "react";
import {
  createWebhookEndpointFormAction,
  type CreateEndpointFormState,
} from "@/modules/webhooks/actions";

const EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "lead.accepted",
  "lead.declined",
  "lead.reassigned",
  "lead.status_changed",
  "lead.converted",
  "lead.lost",
] as const;

export function CreateEndpointForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createWebhookEndpointFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<CreateEndpointFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction}>
      <label>
        Endpoint URL
        <input
          type="url"
          name="url"
          required
          placeholder="https://example.com/webhooks/leads"
        />
      </label>
      <fieldset>
        <legend>Subscribed events</legend>
        {EVENT_TYPES.map((eventType) => (
          <label key={eventType}>
            <input type="checkbox" name={eventType} />
            {eventType}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending}>
        Create endpoint
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.secret ? (
        <p>
          Signing secret (shown once — copy it now): <code>{state.secret}</code>
        </p>
      ) : null}
    </form>
  );
}
