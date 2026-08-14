"use client";

import { useActionState } from "react";
import {
  rotateLeadSourceTokenFormAction,
  type RotateTokenFormState,
} from "@/modules/lead-sources/actions";
import { Button } from "@/components/Button";
import { IntakeUrlReveal } from "@/components/IntakeUrl";

export function RotateTokenForm({
  orgSlug,
  leadSourceId,
}: {
  orgSlug: string;
  leadSourceId: string;
}) {
  const boundAction = rotateLeadSourceTokenFormAction.bind(null, orgSlug, leadSourceId);
  const [state, formAction, pending] = useActionState<RotateTokenFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <Button type="submit" variant="secondary" disabled={pending}>
          Regenerate URL
        </Button>
      </form>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.plaintextToken ? (
        <IntakeUrlReveal plaintextToken={state.plaintextToken} />
      ) : null}
    </div>
  );
}
