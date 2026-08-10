"use client";

import { useActionState } from "react";
import {
  rotateWebhookSecretFormAction,
  toggleWebhookEndpointStatusAction,
  deleteWebhookEndpointAction,
  type RotateSecretFormState,
} from "@/modules/webhooks/actions";

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
    <div>
      <form action={formAction} style={{ display: "inline" }}>
        <button type="submit" disabled={pending}>
          Rotate secret
        </button>
      </form>{" "}
      <form action={toggleAction} style={{ display: "inline" }}>
        <button type="submit">{status === "active" ? "Deactivate" : "Activate"}</button>
      </form>{" "}
      <form action={deleteAction} style={{ display: "inline" }}>
        <button type="submit">Delete</button>
      </form>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.secret ? (
        <p>
          New signing secret (shown once — copy it now): <code>{state.secret}</code>
        </p>
      ) : null}
    </div>
  );
}
