"use client";

import { useActionState } from "react";
import {
  rotateWebhookSecretFormAction,
  toggleWebhookEndpointStatusAction,
  deleteWebhookEndpointAction,
  type RotateSecretFormState,
} from "@/modules/webhooks/actions";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export function EndpointActions({
  orgSlug,
  endpointId,
  status,
}: {
  orgSlug: string;
  endpointId: string;
  status: "active" | "inactive";
}) {
  const boundRotateAction = rotateWebhookSecretFormAction.bind(null, orgSlug, endpointId);
  const [state, formAction, pending] = useActionState<RotateSecretFormState, FormData>(
    boundRotateAction,
    {},
  );
  const toggleAction = toggleWebhookEndpointStatusAction.bind(
    null,
    orgSlug,
    endpointId,
    status === "active" ? "inactive" : "active",
  );
  const deleteAction = deleteWebhookEndpointAction.bind(null, orgSlug, endpointId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <Button type="submit" variant="secondary" disabled={pending}>
            Rotate secret
          </Button>
        </form>
        <form action={toggleAction}>
          <Button type="submit" variant="secondary">
            {status === "active" ? "Deactivate" : "Activate"}
          </Button>
        </form>
        <form action={deleteAction}>
          <Button type="submit" variant="danger">
            Delete
          </Button>
        </form>
      </div>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.secret ? (
        <Card className="text-sm">
          New signing secret (shown once — copy it now): <code>{state.secret}</code>
        </Card>
      ) : null}
    </div>
  );
}
