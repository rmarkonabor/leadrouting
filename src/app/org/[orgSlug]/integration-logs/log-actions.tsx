"use client";

import {
  retryIntegrationJobAction,
  markIntegrationLogResolvedAction,
} from "@/modules/integration-logs/actions";
import { Button } from "@/components/Button";

export function LogActions({
  orgSlug,
  jobId,
  logId,
}: {
  orgSlug: string;
  jobId: string | null;
  logId: string;
}) {
  const retryAction = jobId ? retryIntegrationJobAction.bind(null, orgSlug, jobId) : null;
  const resolveAction = markIntegrationLogResolvedAction.bind(null, orgSlug, logId);

  return (
    <div className="flex gap-2">
      {retryAction ? (
        <form action={retryAction}>
          <Button type="submit" variant="secondary" className="px-2 py-0.5 text-xs">
            Retry
          </Button>
        </form>
      ) : null}
      <form action={resolveAction}>
        <Button type="submit" variant="secondary" className="px-2 py-0.5 text-xs">
          Mark resolved
        </Button>
      </form>
    </div>
  );
}
