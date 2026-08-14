"use client";

import {
  ignoreSubmissionLogAction,
  resubmitSubmissionLogAction,
} from "@/modules/submission-logs/actions";
import type { SubmissionLogStatus } from "@/lib/supabase/database.types";
import { Button } from "@/components/Button";

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
    <div className="flex gap-2">
      <form action={resubmitSubmissionLogAction.bind(null, orgSlug, submissionLogId)}>
        <Button type="submit" variant="secondary">
          Resubmit
        </Button>
      </form>
      <form action={ignoreSubmissionLogAction.bind(null, orgSlug, submissionLogId)}>
        <Button type="submit" variant="danger">
          Ignore
        </Button>
      </form>
    </div>
  );
}
