"use client";

import { useActionState } from "react";
import {
  updateAvailabilityFormAction,
  type UpdateAvailabilityFormState,
} from "@/modules/availability/actions";

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
    <form action={formAction}>
      <label>
        Status
        <select name="availabilityStatus" defaultValue={currentStatus}>
          <option value="available">Available</option>
          <option value="busy">Busy</option>
          <option value="away">Away</option>
          <option value="vacation">Vacation</option>
          <option value="offline">Offline</option>
        </select>
      </label>
      <label>
        Note
        <input type="text" name="statusNote" />
      </label>
      <button type="submit" disabled={pending}>
        Update
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
