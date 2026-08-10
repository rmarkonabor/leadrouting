"use server";

import { revalidatePath } from "next/cache";
import {
  connectIntegration,
  disconnectIntegration,
  testExistingConnection,
} from "./connections";
import { upsertFieldMapping, deleteFieldMapping } from "./field-mappings";
import { toAppError } from "@/lib/errors/app-error";

export interface ConnectIntegrationFormState {
  error?: string;
}

export async function connectIntegrationFormAction(
  organizationSlug: string,
  _prevState: ConnectIntegrationFormState,
  formData: FormData,
): Promise<ConnectIntegrationFormState> {
  const provider = String(formData.get("provider") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();

  try {
    await connectIntegration(organizationSlug, {
      provider,
      settings: { baseUrl },
      credentials: { accessToken: apiKey },
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/crm-integration`);
  return {};
}

export async function disconnectIntegrationAction(
  organizationSlug: string,
  connectionId: string,
) {
  await disconnectIntegration(organizationSlug, connectionId);
  revalidatePath(`/org/${organizationSlug}/crm-integration`);
}

export interface TestConnectionFormState {
  result?: string;
  error?: string;
}

export async function testConnectionFormAction(
  organizationSlug: string,
  connectionId: string,
  _prevState: TestConnectionFormState,
  _formData: FormData,
): Promise<TestConnectionFormState> {
  try {
    const { ok } = await testExistingConnection(organizationSlug, connectionId);
    return { result: ok ? "Connection is healthy." : "Connection test failed." };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface UpsertFieldMappingFormState {
  error?: string;
}

export async function upsertFieldMappingFormAction(
  organizationSlug: string,
  connectionId: string,
  _prevState: UpsertFieldMappingFormState,
  formData: FormData,
): Promise<UpsertFieldMappingFormState> {
  const sourceField = String(formData.get("sourceField") ?? "").trim();
  const crmField = String(formData.get("crmField") ?? "").trim();
  const transformationRaw = String(formData.get("transformation") ?? "").trim();

  try {
    await upsertFieldMapping(organizationSlug, connectionId, {
      sourceField,
      crmField,
      transformation: transformationRaw
        ? (transformationRaw as Parameters<
            typeof upsertFieldMapping
          >[2]["transformation"])
        : null,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/crm-integration`);
  return {};
}

export async function deleteFieldMappingAction(
  organizationSlug: string,
  mappingId: string,
) {
  await deleteFieldMapping(organizationSlug, mappingId);
  revalidatePath(`/org/${organizationSlug}/crm-integration`);
}
