"use client";

import { useActionState } from "react";
import { addNoteFormAction, type AddNoteFormState } from "@/modules/notes/actions";
import { Textarea } from "@/components/Input";
import { Button } from "@/components/Button";

export function AddNoteForm({ orgSlug, leadId }: { orgSlug: string; leadId: string }) {
  const boundAction = addNoteFormAction.bind(null, orgSlug, leadId);
  const [state, formAction, pending] = useActionState<AddNoteFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Textarea
        name="content"
        required
        maxLength={5000}
        rows={3}
        placeholder="Add a note"
      />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Add note
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
