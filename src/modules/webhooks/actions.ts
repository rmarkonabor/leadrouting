"use server";

import { revalidatePath } from "next/cache";
import {
  createWebhookEndpoint,
  rotateWebhookSecret,
  updateWebhookEndpointStatus,
  deleteWebhookEndpoint,
} from "./endpoints";
import { toAppError } from "@/lib/errors/app-error";
import type { WebhookEventType } from "@/lib/supabase/database.types";

const ALL_EVENT_TYPES: WebhookEventType[] = [
  "lead.created",
  "lead.assigned",
  "lead.accepted",
  "lead.declined",
  "lead.reassigned",
  "lead.status_changed",
  "lead.converted",
  "lead.lost",
];

export interface CreateEndpointFormState {
  error?: string;
  secret?: string;
}

export async function createWebhookEndpointFormAction(
  organizationSlug: string,
  _prevState: CreateEndpointFormState,
  formData: FormData,
): Promise<CreateEndpointFormState> {
  const url = String(formData.get("url") ?? "").trim();
  const subscribedEvents = ALL_EVENT_TYPES.filter(
    (eventType) => formData.get(eventType) === "on",
  );

  try {
    const { secret } = await createWebhookEndpoint(organizationSlug, {
      url,
      subscribedEvents,
    });
    revalidatePath(`/org/${organizationSlug}/webhooks`);
    return { secret };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface RotateSecretFormState {
  error?: string;
  secret?: string;
}

export async function rotateWebhookSecretFormAction(
  organizationSlug: string,
  endpointId: string,
  _prevState: RotateSecretFormState,
): Promise<RotateSecretFormState> {
  try {
    const { secret } = await rotateWebhookSecret(organizationSlug, endpointId);
    revalidatePath(`/org/${organizationSlug}/webhooks`);
    return { secret };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export async function toggleWebhookEndpointStatusAction(
  organizationSlug: string,
  endpointId: string,
  status: "active" | "inactive",
) {
  await updateWebhookEndpointStatus(organizationSlug, endpointId, status);
  revalidatePath(`/org/${organizationSlug}/webhooks`);
}

export async function deleteWebhookEndpointAction(
  organizationSlug: string,
  endpointId: string,
) {
  await deleteWebhookEndpoint(organizationSlug, endpointId);
  revalidatePath(`/org/${organizationSlug}/webhooks`);
}
