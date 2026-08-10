"use server";

import { revalidatePath } from "next/cache";
import { resolveManualReviewItem, dismissManualReviewItem } from "./manual-review";
import { manuallyAssignLead } from "@/modules/assignments/manual-assignment";
import { toAppError } from "@/lib/errors/app-error";

export async function resolveManualReviewItemAction(
  organizationSlug: string,
  itemId: string,
) {
  await resolveManualReviewItem(organizationSlug, itemId);
  revalidatePath(`/org/${organizationSlug}/manual-review`);
}

export async function dismissManualReviewItemAction(
  organizationSlug: string,
  itemId: string,
) {
  await dismissManualReviewItem(organizationSlug, itemId);
  revalidatePath(`/org/${organizationSlug}/manual-review`);
}

export interface ManuallyAssignFormState {
  error?: string;
}

export async function manuallyAssignFromReviewFormAction(
  organizationSlug: string,
  leadId: string,
  _prevState: ManuallyAssignFormState,
  formData: FormData,
): Promise<ManuallyAssignFormState> {
  const userId = String(formData.get("userId") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "").trim();

  try {
    await manuallyAssignLead(organizationSlug, {
      leadId,
      userId,
      teamId: teamId || undefined,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/manual-review`);
  return {};
}
