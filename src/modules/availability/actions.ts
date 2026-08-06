"use server";

import { revalidatePath } from "next/cache";
import { updateOwnAvailability } from "./availability";
import { toAppError } from "@/lib/errors/app-error";
import type { AvailabilityStatus } from "@/lib/supabase/database.types";

export interface UpdateAvailabilityFormState {
  error?: string;
}

export async function updateAvailabilityFormAction(
  organizationSlug: string,
  _prevState: UpdateAvailabilityFormState,
  formData: FormData,
): Promise<UpdateAvailabilityFormState> {
  const availabilityStatus = String(
    formData.get("availabilityStatus") ?? "available",
  ) as AvailabilityStatus;
  const statusNote = String(formData.get("statusNote") ?? "") || undefined;

  try {
    await updateOwnAvailability(organizationSlug, { availabilityStatus, statusNote });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/availability`);
  return {};
}
