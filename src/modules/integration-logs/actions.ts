"use server";

import { revalidatePath } from "next/cache";
import { retryIntegrationJob, markIntegrationLogResolved } from "./integration-logs";

export async function retryIntegrationJobAction(organizationSlug: string, jobId: string) {
  await retryIntegrationJob(organizationSlug, jobId);
  revalidatePath(`/org/${organizationSlug}/integration-logs`);
}

export async function markIntegrationLogResolvedAction(
  organizationSlug: string,
  logId: string,
) {
  await markIntegrationLogResolved(organizationSlug, logId);
  revalidatePath(`/org/${organizationSlug}/integration-logs`);
}
