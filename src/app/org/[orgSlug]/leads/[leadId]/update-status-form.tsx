"use client";

import { useActionState } from "react";
import {
  updateLeadStatusFormAction,
  type UpdateLeadStatusFormState,
} from "@/modules/leads/actions";
import { Select } from "@/components/Input";
import { Button } from "@/components/Button";

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
    <form action={formAction} className="flex items-end gap-2">
      <Select name="status" defaultValue={currentStatus ?? ""} className="max-w-xs">
        {statusOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" disabled={pending}>
        Update status
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
