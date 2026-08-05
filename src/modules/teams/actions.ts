"use server";

import { revalidatePath } from "next/cache";
import { createTeam } from "./teams";
import { toAppError } from "@/lib/errors/app-error";

export interface CreateTeamFormState {
  error?: string;
}

export async function createTeamFormAction(
  organizationSlug: string,
  _prevState: CreateTeamFormState,
  formData: FormData,
): Promise<CreateTeamFormState> {
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "") || undefined;

  try {
    await createTeam(organizationSlug, { name, description });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/teams`);
  return {};
}
