import {
  listIntegrationLogs,
  listWebhookDeliveries,
} from "@/modules/integration-logs/integration-logs";
import { LogActions } from "./log-actions";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/Table";

export default async function IntegrationLogsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [data, loadError] = await Promise.all([
    listIntegrationLogs(orgSlug),
    listWebhookDeliveries(orgSlug),
  ]).then(
    ([logs, deliveries]) => [{ logs, deliveries }, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !data) {
    return (
      <PageContainer>
        <PageTitle>Integration logs</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Integration logs</PageTitle>

      <Section title={`CRM sync (${data.logs.total})`}>
        {data.logs.logs.length === 0 ? (
          <p className="text-sm text-muted">No CRM sync activity yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Provider</TableHeaderCell>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Attempts</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.logs.logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.created_at}</TableCell>
                  <TableCell>{log.provider}</TableCell>
                  <TableCell>{log.event_type}</TableCell>
                  <TableCell>
                    <StatusBadge status={log.status} />
                  </TableCell>
                  <TableCell>{log.attempt_count}</TableCell>
                  <TableCell>
                    {log.status === "failed" || log.status === "dead_letter" ? (
                      <LogActions
                        orgSlug={orgSlug}
                        jobId={log.integration_job_id}
                        logId={log.id}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={`Webhook deliveries (${data.deliveries.total})`}>
        {data.deliveries.deliveries.length === 0 ? (
          <p className="text-sm text-muted">No webhook delivery activity yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Response</TableHeaderCell>
                <TableHeaderCell>Attempts</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.deliveries.deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>{delivery.created_at}</TableCell>
                  <TableCell>{delivery.event_type}</TableCell>
                  <TableCell>
                    <StatusBadge status={delivery.status} />
                  </TableCell>
                  <TableCell>{delivery.last_response_status ?? "—"}</TableCell>
                  <TableCell>{delivery.attempt_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </PageContainer>
  );
}
