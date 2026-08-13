"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createManualLeadFormAction,
  type CreateManualLeadFormState,
} from "@/modules/leads/actions";

export function NewLeadForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createManualLeadFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateManualLeadFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        First name
        <input type="text" name="firstName" />
      </label>
      <label>
        Last name
        <input type="text" name="lastName" />
      </label>
      <label>
        Email
        <input type="email" name="email" />
      </label>
      <label>
        Phone
        <input type="text" name="phone" />
      </label>
      <label>
        Street address
        <input type="text" name="streetAddress" />
      </label>
      <label>
        Unit number
        <input type="text" name="unitNumber" />
      </label>
      <label>
        Neighborhood
        <input type="text" name="neighborhood" />
      </label>
      <label>
        City
        <input type="text" name="city" />
      </label>
      <label>
        County
        <input type="text" name="county" />
      </label>
      <label>
        State / province
        <input type="text" name="stateProvince" />
      </label>
      <label>
        Postal code
        <input type="text" name="postalCode" />
      </label>
      <label>
        Country
        <input type="text" name="country" />
      </label>
      <label>
        Message
        <textarea name="message" />
      </label>
      <button type="submit" disabled={pending}>
        Create lead
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.leadId ? (
        <p>
          Lead created — routing outcome: <strong>{state.routingOutcome}</strong>.{" "}
          <Link href={`/org/${orgSlug}/leads/${state.leadId}`}>View lead</Link>
        </p>
      ) : null}
    </form>
  );
}
