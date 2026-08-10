"use client";

import { useActionState } from "react";
import {
  updateLeadStatusFormAction,
  type UpdateLeadStatusFormState,
} from "@/modules/leads/actions";

export function UpdateStatusForm({
  orgSlug,
  leadId,
  currentStatus,
  statusOptions,
}: {
  orgSlug: string;
  leadId: string;
  currentStatus: string | null;
  statusOptions: Array<{ key: string; label: string }>;
}) {
  const boundAction = updateLeadStatusFormAction.bind(null, orgSlug, leadId);
  const [state, formAction, pending] = useActionState<
    UpdateLeadStatusFormState,
    FormData
  >(boundAction, {});

  return (
    <form action={formAction}>
      <label>
        Lead status
        <select name="status" defaultValue={currentStatus ?? ""}>
          {statusOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Update status
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
