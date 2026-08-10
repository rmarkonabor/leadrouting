"use server";

import { revalidatePath } from "next/cache";
import { addNote } from "./notes";
import { toAppError } from "@/lib/errors/app-error";

export interface AddNoteFormState {
  error?: string;
}

export async function addNoteFormAction(
  organizationSlug: string,
  leadId: string,
  _prevState: AddNoteFormState,
  formData: FormData,
): Promise<AddNoteFormState> {
  const content = String(formData.get("content") ?? "").trim();

  try {
    await addNote(organizationSlug, leadId, content);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/leads/${leadId}`);
  return {};
}
