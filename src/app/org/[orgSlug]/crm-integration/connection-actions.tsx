"use client";

import { useActionState } from "react";
import {
  disconnectIntegrationAction,
  testConnectionFormAction,
  type TestConnectionFormState,
} from "@/modules/integrations/actions";
import { Button } from "@/components/Button";

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
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={formAction}>
          <Button type="submit" variant="secondary" disabled={pending}>
            Test connection
          </Button>
        </form>
        <form action={disconnectAction}>
          <Button type="submit" variant="danger">
            Disconnect
          </Button>
        </form>
      </div>
      {state.result ? <p className="text-sm">{state.result}</p> : null}
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </div>
  );
}
