"use client";

import {
  retryIntegrationJobAction,
  markIntegrationLogResolvedAction,
} from "@/modules/integration-logs/actions";

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
    <span>
      {retryAction ? (
        <form action={retryAction} style={{ display: "inline" }}>
          <button type="submit">Retry</button>
        </form>
      ) : null}{" "}
      <form action={resolveAction} style={{ display: "inline" }}>
        <button type="submit">Mark resolved</button>
      </form>
    </span>
  );
}
