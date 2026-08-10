"use server";

import { revalidatePath } from "next/cache";
import { updateLeadStatus } from "./get-lead-detail";
import { toAppError } from "@/lib/errors/app-error";

export interface UpdateLeadStatusFormState {
  error?: string;
}

export async function updateLeadStatusFormAction(
  organizationSlug: string,
  leadId: string,
  _prevState: UpdateLeadStatusFormState,
  formData: FormData,
): Promise<UpdateLeadStatusFormState> {
  const newStatus = String(formData.get("status") ?? "").trim();

  try {
    await updateLeadStatus(organizationSlug, leadId, newStatus);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/leads/${leadId}`);
  return {};
}
