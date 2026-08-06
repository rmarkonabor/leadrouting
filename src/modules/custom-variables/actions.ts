"use server";

import { revalidatePath } from "next/cache";
import { createCustomVariableDefinition } from "./custom-variables";
import { toAppError } from "@/lib/errors/app-error";
import type { AttributeFieldType } from "@/lib/supabase/database.types";

export interface CreateCustomVariableFormState {
  error?: string;
}

export async function createCustomVariableFormAction(
  organizationSlug: string,
  _prevState: CreateCustomVariableFormState,
  formData: FormData,
): Promise<CreateCustomVariableFormState> {
  const name = String(formData.get("name") ?? "");
  const internalKey = String(formData.get("internalKey") ?? "");
  const fieldType = String(formData.get("fieldType") ?? "text") as AttributeFieldType;

  try {
    await createCustomVariableDefinition(organizationSlug, {
      name,
      internalKey,
      fieldType,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/custom-variables`);
  return {};
}
