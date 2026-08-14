"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createManualLeadFormAction,
  type CreateManualLeadFormState,
} from "@/modules/leads/actions";
import { Field } from "@/components/Field";
import { Input, Textarea } from "@/components/Input";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/Badge";
import { Card } from "@/components/Card";

export function NewLeadForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createManualLeadFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateManualLeadFormState,
    FormData
  >(boundAction, {});

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName">
          <Input id="firstName" type="text" name="firstName" />
        </Field>
        <Field label="Last name" htmlFor="lastName">
          <Input id="lastName" type="text" name="lastName" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" name="email" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" type="text" name="phone" />
        </Field>
        <Field label="Street address" htmlFor="streetAddress">
          <Input id="streetAddress" type="text" name="streetAddress" />
        </Field>
        <Field label="Unit number" htmlFor="unitNumber">
          <Input id="unitNumber" type="text" name="unitNumber" />
        </Field>
        <Field label="Neighborhood" htmlFor="neighborhood">
          <Input id="neighborhood" type="text" name="neighborhood" />
        </Field>
        <Field label="City" htmlFor="city">
          <Input id="city" type="text" name="city" />
        </Field>
        <Field label="County" htmlFor="county">
          <Input id="county" type="text" name="county" />
        </Field>
        <Field label="State / province" htmlFor="stateProvince">
          <Input id="stateProvince" type="text" name="stateProvince" />
        </Field>
        <Field label="Postal code" htmlFor="postalCode">
          <Input id="postalCode" type="text" name="postalCode" />
        </Field>
        <Field label="Country" htmlFor="country">
          <Input id="country" type="text" name="country" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Message" htmlFor="message">
            <Textarea id="message" name="message" rows={3} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            Create lead
          </Button>
        </div>
      </form>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.leadId ? (
        <Card className="flex items-center gap-2">
          <span className="text-sm">Lead created — routing outcome:</span>
          <StatusBadge status={state.routingOutcome} />
          <Link
            href={`/org/${orgSlug}/leads/${state.leadId}`}
            className="text-sm text-brand-600 hover:underline"
          >
            View lead
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
