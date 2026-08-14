import { listSubmissionLogs } from "@/modules/submission-logs/submission-logs";
import { SubmissionLogRowActions } from "./submission-log-row-actions";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Card } from "@/components/Card";
import { Badge, StatusBadge } from "@/components/Badge";
import { CodeBlock } from "@/components/CodeBlock";

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
      <PageContainer>
        <PageTitle>Submission logs</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Submission logs</PageTitle>
      <div className="flex flex-col gap-3">
        {logs.map((log) => (
          <Card key={log.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">{log.created_at}</span>
              <StatusBadge status={log.status} />
              {log.test_mode ? <Badge variant="info">test mode</Badge> : null}
              {log.resulting_lead_id ? (
                <a
                  href={`/org/${orgSlug}/leads/${log.resulting_lead_id}`}
                  className="text-brand-600 hover:underline"
                >
                  View resulting lead
                </a>
              ) : null}
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-muted">
                Original payload
              </summary>
              <div className="mt-2">
                <CodeBlock value={log.raw_payload} />
              </div>
            </details>
            <SubmissionLogRowActions
              orgSlug={orgSlug}
              submissionLogId={log.id}
              status={log.status}
              hasResultingLead={log.resulting_lead_id !== null}
            />
          </Card>
        ))}
        {logs.length === 0 ? (
          <p className="text-sm text-muted">No submissions yet.</p>
        ) : null}
      </div>
    </PageContainer>
  );
}
