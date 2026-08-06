"use client";

import { useActionState } from "react";
import {
  simulateRoutingFormAction,
  type SimulateRoutingFormState,
} from "@/modules/routing/actions";

export function SimulatorForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = simulateRoutingFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<SimulateRoutingFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <>
      <form action={formAction}>
        <label>
          Lead ID
          <input
            type="text"
            name="leadId"
            required
            placeholder="00000000-0000-0000-0000-000000000000"
          />
        </label>
        <button type="submit" disabled={pending}>
          Simulate
        </button>
      </form>

      {state.error ? <p role="alert">{state.error}</p> : null}

      {state.explanation ? (
        <section>
          <h2>Explanation</h2>
          <pre>{state.explanation}</pre>

          <h3>Structured result</h3>
          <pre>{JSON.stringify(state.raw, null, 2)}</pre>
        </section>
      ) : null}
    </>
  );
}
