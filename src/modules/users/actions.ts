"use server";

import { revalidatePath } from "next/cache";
import { inviteUser } from "./invite-user";
import { deactivateUser, activateUser } from "./manage-user";
import { toAppError } from "@/lib/errors/app-error";
import type { OrganizationRole } from "@/lib/supabase/database.types";

export interface InviteUserFormState {
  error?: string;
}

export async function inviteUserFormAction(
  organizationSlug: string,
  _prevState: InviteUserFormState,
  formData: FormData,
): Promise<InviteUserFormState> {
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "agent") as OrganizationRole;

  try {
    await inviteUser(organizationSlug, { email, role });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/users`);
  return {};
}

export async function deactivateUserAction(
  organizationSlug: string,
  organizationUserId: string,
) {
  await deactivateUser(organizationSlug, organizationUserId);
  revalidatePath(`/org/${organizationSlug}/users`);
}

export async function activateUserAction(
  organizationSlug: string,
  organizationUserId: string,
) {
  await activateUser(organizationSlug, organizationUserId);
  revalidatePath(`/org/${organizationSlug}/users`);
}
