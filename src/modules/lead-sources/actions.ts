"use server";

import { revalidatePath } from "next/cache";
import { createLeadSource, rotateLeadSourceToken } from "./lead-sources";
import { toAppError } from "@/lib/errors/app-error";
import type { LeadSourceType } from "@/lib/supabase/database.types";

export interface CreateLeadSourceFormState {
  error?: string;
  plaintextToken?: string;
}

export async function createLeadSourceFormAction(
  organizationSlug: string,
  _prevState: CreateLeadSourceFormState,
  formData: FormData,
): Promise<CreateLeadSourceFormState> {
  const name = String(formData.get("name") ?? "");
  const sourceType = String(formData.get("sourceType") ?? "webhook") as LeadSourceType;

  try {
    const { plaintextToken } = await createLeadSource(organizationSlug, {
      name,
      sourceType,
    });
    revalidatePath(`/org/${organizationSlug}/lead-sources`);
    return { plaintextToken };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface RotateTokenFormState {
  error?: string;
  plaintextToken?: string;
}

export async function rotateLeadSourceTokenFormAction(
  organizationSlug: string,
  leadSourceId: string,
  _prevState: RotateTokenFormState,
  _formData: FormData,
): Promise<RotateTokenFormState> {
  try {
    const { plaintextToken } = await rotateLeadSourceToken(
      organizationSlug,
      leadSourceId,
    );
    revalidatePath(`/org/${organizationSlug}/lead-sources`);
    return { plaintextToken };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
