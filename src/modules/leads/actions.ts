"use server";

import { revalidatePath } from "next/cache";
import { updateLeadStatus } from "./get-lead-detail";
import { createManualLead, type ManualLeadInput } from "./manual-lead-entry";
import { toAppError } from "@/lib/errors/app-error";

export interface UpdateLeadStatusFormState {
  error?: string;
}

export interface CreateManualLeadFormState {
  error?: string;
  leadId?: string;
  routingOutcome?: string;
}

export async function createManualLeadFormAction(
  organizationSlug: string,
  _prevState: CreateManualLeadFormState,
  formData: FormData,
): Promise<CreateManualLeadFormState> {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };

  const input: ManualLeadInput = {
    firstName: field("firstName"),
    lastName: field("lastName"),
    email: field("email"),
    phone: field("phone"),
    streetAddress: field("streetAddress"),
    unitNumber: field("unitNumber"),
    neighborhood: field("neighborhood"),
    city: field("city"),
    county: field("county"),
    stateProvince: field("stateProvince"),
    postalCode: field("postalCode"),
    country: field("country"),
    message: field("message"),
  };

  try {
    const result = await createManualLead(organizationSlug, input);
    revalidatePath(`/org/${organizationSlug}/leads`);
    return {
      leadId: result.leadId,
      routingOutcome: result.routing?.outcome as string | undefined,
    };
  } catch (error) {
    return { error: toAppError(error).message };
  }
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
