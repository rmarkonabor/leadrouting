"use client";

import { useActionState } from "react";
import {
  publishRoutingFlowFormAction,
  type PublishRoutingFlowFormState,
} from "@/modules/routing/actions";

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
    <form action={formAction}>
      <button type="submit" disabled={pending}>
        Publish current rules
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.versionNumber ? <p>Published as version {state.versionNumber}.</p> : null}
    </form>
  );
}
