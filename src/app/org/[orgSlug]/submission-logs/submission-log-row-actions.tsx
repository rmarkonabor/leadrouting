"use client";

import {
  ignoreSubmissionLogAction,
  resubmitSubmissionLogAction,
} from "@/modules/submission-logs/actions";
import type { SubmissionLogStatus } from "@/lib/supabase/database.types";

export function SubmissionLogRowActions({
  orgSlug,
  submissionLogId,
  status,
  hasResultingLead,
}: {
  orgSlug: string;
  submissionLogId: string;
  status: SubmissionLogStatus;
  hasResultingLead: boolean;
}) {
  if (hasResultingLead || status === "ignored" || status === "resubmitted") {
    return null;
  }

  return (
    <>
      <form action={resubmitSubmissionLogAction.bind(null, orgSlug, submissionLogId)}>
        <button type="submit">Resubmit</button>
      </form>
      <form action={ignoreSubmissionLogAction.bind(null, orgSlug, submissionLogId)}>
        <button type="submit">Ignore</button>
      </form>
    </>
  );
}
