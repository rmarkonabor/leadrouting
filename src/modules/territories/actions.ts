"use server";

import { revalidatePath } from "next/cache";
import { createTerritory, type CreateTerritoryInput } from "./territories";
import { toAppError } from "@/lib/errors/app-error";
import type { TerritoryType } from "@/lib/supabase/database.types";

export interface CreateTerritoryFormState {
  error?: string;
}

export async function createTerritoryFormAction(
  organizationSlug: string,
  _prevState: CreateTerritoryFormState,
  formData: FormData,
): Promise<CreateTerritoryFormState> {
  const territoryType = String(
    formData.get("territoryType") ?? "country",
  ) as TerritoryType;
  const input: CreateTerritoryInput = {
    name: String(formData.get("name") ?? ""),
    territoryType,
    priority: Number(formData.get("priority") ?? 100),
  };

  const fieldByType: Partial<Record<TerritoryType, keyof CreateTerritoryInput>> = {
    country: "country",
    state_province: "stateProvince",
    county: "county",
    city: "city",
    neighborhood: "neighborhood",
    postal_code: "postalCode",
  };
  const field = fieldByType[territoryType];
  if (field) {
    const value = String(formData.get("value") ?? "").trim();
    if (value) {
      (input as Record<string, unknown>)[field] = value;
    }
  }

  try {
    await createTerritory(organizationSlug, input);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/territories`);
  return {};
}
