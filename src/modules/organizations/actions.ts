"use server";

import { revalidatePath } from "next/cache";
import { createOrganization } from "./create-organization";
import { toAppError } from "@/lib/errors/app-error";

export interface CreateOrganizationFormState {
  error?: string;
}

export async function createOrganizationFormAction(
  _prevState: CreateOrganizationFormState,
  formData: FormData,
): Promise<CreateOrganizationFormState> {
  const name = String(formData.get("name") ?? "");
  const slug = String(formData.get("slug") ?? "");

  try {
    await createOrganization({ name, slug });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/");
  return {};
}
