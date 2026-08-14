"use client";

import { useActionState } from "react";
import {
  publishRoutingFlowFormAction,
  type PublishRoutingFlowFormState,
} from "@/modules/routing/actions";
import { Button } from "@/components/Button";

export function PublishFlowButton({
  orgSlug,
  flowId,
}: {
  orgSlug: string;
  flowId: string;
}) {
  const boundAction = publishRoutingFlowFormAction.bind(null, orgSlug, flowId);
  const [state, formAction, pending] = useActionState<
    PublishRoutingFlowFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        Publish current rules
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.versionNumber ? (
        <p className="text-sm text-success-text">
          Published as version {state.versionNumber}.
        </p>
      ) : null}
    </form>
  );
}
