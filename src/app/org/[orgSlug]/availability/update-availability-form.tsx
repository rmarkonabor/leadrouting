"use client";

import { useActionState } from "react";
import {
  updateAvailabilityFormAction,
  type UpdateAvailabilityFormState,
} from "@/modules/availability/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function UpdateAvailabilityForm({
  orgSlug,
  currentStatus,
}: {
  orgSlug: string;
  currentStatus: string;
}) {
  const boundAction = updateAvailabilityFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<
    UpdateAvailabilityFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Status" htmlFor="availabilityStatus">
        <Select
          id="availabilityStatus"
          name="availabilityStatus"
          defaultValue={currentStatus}
        >
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="away">Away</option>
          <option value="vacation">Vacation</option>
          <option value="offline">Offline</option>
        </Select>
      </Field>
      <Field label="Note" htmlFor="statusNote">
        <Input id="statusNote" type="text" name="statusNote" />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Update
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
