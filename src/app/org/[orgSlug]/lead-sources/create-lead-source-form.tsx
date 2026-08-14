"use client";

import { useActionState } from "react";
import {
  createLeadSourceFormAction,
  type CreateLeadSourceFormState,
} from "@/modules/lead-sources/actions";
import { Field } from "@/components/Field";
import { Select } from "@/components/Input";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { IntakeUrlReveal } from "@/components/IntakeUrl";

export function CreateLeadSourceForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = createLeadSourceFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    CreateLeadSourceFormState,
    FormData
  >(boundAction, {});

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex max-w-sm flex-col gap-3">
        <Field label="Name" htmlFor="name">
          <Input id="name" type="text" name="name" required />
        </Field>
        <Field label="Source type" htmlFor="sourceType">
          <Select id="sourceType" name="sourceType" defaultValue="webhook">
            <option value="webhook">Webhook</option>
            <option value="external_form">External form embed</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending} className="self-start">
          Create lead source
        </Button>
      </form>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
      {state.plaintextToken ? (
        <IntakeUrlReveal plaintextToken={state.plaintextToken} />
      ) : null}
    </div>
  );
}
