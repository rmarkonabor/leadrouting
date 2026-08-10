"use client";

import { useActionState } from "react";
import { addNoteFormAction, type AddNoteFormState } from "@/modules/notes/actions";

export function AddNoteForm({ orgSlug, leadId }: { orgSlug: string; leadId: string }) {
  const boundAction = addNoteFormAction.bind(null, orgSlug, leadId);
  const [state, formAction, pending] = useActionState<AddNoteFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction}>
      <label>
        Add a note
        <textarea name="content" required maxLength={5000} rows={3} />
      </label>
      <button type="submit" disabled={pending}>
        Add note
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
