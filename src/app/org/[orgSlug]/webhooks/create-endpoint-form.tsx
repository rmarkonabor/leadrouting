"use client";

import { useActionState } from "react";
import {
  createWebhookEndpointFormAction,
  type CreateEndpointFormState,
} from "@/modules/webhooks/actions";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

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
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <Field label="Endpoint URL" htmlFor="url">
          <Input
            id="url"
            type="url"
            name="url"
            required
            placeholder="https://example.com/webhooks/leads"
          />
        </Field>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm text-muted">Subscribed events</legend>
          {EVENT_TYPES.map((eventType) => (
            <label key={eventType} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={eventType} />
              {eventType}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={pending} className="self-start">
          Create endpoint
        </Button>
      </form>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.secret ? (
        <Card className="text-sm">
          Signing secret (shown once — copy it now): <code>{state.secret}</code>
        </Card>
      ) : null}
    </div>
  );
}
