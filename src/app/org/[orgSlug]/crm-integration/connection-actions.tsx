"use client";

import { useActionState } from "react";
import {
  disconnectIntegrationAction,
  testConnectionFormAction,
  type TestConnectionFormState,
} from "@/modules/integrations/actions";

export function ConnectionActions({
  orgSlug,
  connectionId,
}: {
  orgSlug: string;
  connectionId: string;
}) {
  const boundTestAction = testConnectionFormAction.bind(null, orgSlug, connectionId);
  const [state, formAction, pending] = useActionState<TestConnectionFormState, FormData>(
    boundTestAction,
    {},
  );
  const disconnectAction = disconnectIntegrationAction.bind(null, orgSlug, connectionId);

  return (
    <div>
      <form action={formAction} style={{ display: "inline" }}>
        <button type="submit" disabled={pending}>
          Test connection
        </button>
      </form>{" "}
      <form action={disconnectAction} style={{ display: "inline" }}>
        <button type="submit">Disconnect</button>
      </form>
      {state.result ? <p>{state.result}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </div>
  );
}
