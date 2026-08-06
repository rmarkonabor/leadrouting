import { listSubmissionLogs } from "@/modules/submission-logs/submission-logs";
import { SubmissionLogRowActions } from "./submission-log-row-actions";
import { toAppError } from "@/lib/errors/app-error";

export default async function SubmissionLogsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [logs, loadError] = await listSubmissionLogs(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !logs) {
    return (
      <main>
        <h1>Submission logs</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Submission logs</h1>
      <ul>
        {logs.map((log) => (
          <li key={log.id}>
            {log.created_at} — {log.status}
            {log.test_mode ? " (test mode)" : ""}
            {log.resulting_lead_id ? ` — lead ${log.resulting_lead_id}` : ""}
            <details>
              <summary>Original payload</summary>
              <pre>{JSON.stringify(log.raw_payload, null, 2)}</pre>
            </details>
            <SubmissionLogRowActions
              orgSlug={orgSlug}
              submissionLogId={log.id}
              status={log.status}
              hasResultingLead={log.resulting_lead_id !== null}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
