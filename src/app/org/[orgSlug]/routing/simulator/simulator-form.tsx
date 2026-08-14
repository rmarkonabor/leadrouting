"use client";

import { useActionState } from "react";
import {
  simulateRoutingFormAction,
  type SimulateRoutingFormState,
} from "@/modules/routing/actions";
import type { RoutingExplanationLike } from "@/modules/routing/format-explanation";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Section } from "@/components/Card";
import { RoutingResultView } from "@/components/RoutingResultView";

export function SimulatorForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = simulateRoutingFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<SimulateRoutingFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Lead ID" htmlFor="leadId">
            <Input
              id="leadId"
              type="text"
              name="leadId"
              required
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          Simulate
        </Button>
      </form>

      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}

      {state.raw ? (
        <Section title="Result">
          <RoutingResultView result={state.raw as unknown as RoutingExplanationLike} />
          {state.explanation ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">
                Plain-text explanation
              </summary>
              <pre className="mt-2 rounded-md bg-neutral-bg p-3 text-xs whitespace-pre-wrap text-neutral-text">
                {state.explanation}
              </pre>
            </details>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
