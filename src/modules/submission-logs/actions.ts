"use server";

import { revalidatePath } from "next/cache";
import { ignoreSubmissionLog, resubmitSubmissionLog } from "./submission-logs";

export async function ignoreSubmissionLogAction(
  organizationSlug: string,
  submissionLogId: string,
) {
  await ignoreSubmissionLog(organizationSlug, submissionLogId);
  revalidatePath(`/org/${organizationSlug}/submission-logs`);
}

export async function resubmitSubmissionLogAction(
  organizationSlug: string,
  submissionLogId: string,
) {
  await resubmitSubmissionLog(organizationSlug, submissionLogId);
  revalidatePath(`/org/${organizationSlug}/submission-logs`);
}
