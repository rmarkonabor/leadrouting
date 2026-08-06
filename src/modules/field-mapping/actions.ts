"use server";

import { revalidatePath } from "next/cache";
import { upsertFieldMapping } from "./field-mappings";
import { toAppError } from "@/lib/errors/app-error";
import type {
  FieldMappingDestinationType,
  FieldMappingTransformation,
} from "@/lib/supabase/database.types";

export interface UpsertFieldMappingFormState {
  error?: string;
}

export async function upsertFieldMappingFormAction(
  organizationSlug: string,
  leadSourceId: string,
  _prevState: UpsertFieldMappingFormState,
  formData: FormData,
): Promise<UpsertFieldMappingFormState> {
  const sourceFieldName = String(formData.get("sourceFieldName") ?? "");
  const destinationType = String(
    formData.get("destinationType") ?? "default_field",
  ) as FieldMappingDestinationType;
  const destinationField = String(formData.get("destinationField") ?? "") || undefined;
  const dataType = String(formData.get("dataType") ?? "text");
  const transformationRaw = String(formData.get("transformation") ?? "");
  const transformation = transformationRaw
    ? (transformationRaw as FieldMappingTransformation)
    : undefined;

  try {
    await upsertFieldMapping(organizationSlug, {
      leadSourceId,
      sourceFieldName,
      destinationType,
      destinationField,
      dataType,
      transformation,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/lead-sources/${leadSourceId}`);
  return {};
}
