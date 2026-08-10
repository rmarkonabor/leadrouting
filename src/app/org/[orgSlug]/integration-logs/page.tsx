import {
  listIntegrationLogs,
  listWebhookDeliveries,
} from "@/modules/integration-logs/integration-logs";
import { LogActions } from "./log-actions";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Integration logs</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Integration logs</h1>

      <section>
        <h2>CRM sync ({data.logs.total})</h2>
        {data.logs.logs.length === 0 ? (
          <p>No CRM sync activity yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Provider</th>
                <th>Event</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.created_at}</td>
                  <td>{log.provider}</td>
                  <td>{log.event_type}</td>
                  <td>{log.status}</td>
                  <td>{log.attempt_count}</td>
                  <td>
                    {log.status === "failed" || log.status === "dead_letter" ? (
                      <LogActions
                        orgSlug={orgSlug}
                        jobId={log.integration_job_id}
                        logId={log.id}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Webhook deliveries ({data.deliveries.total})</h2>
        {data.deliveries.deliveries.length === 0 ? (
          <p>No webhook delivery activity yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Status</th>
                <th>Response</th>
                <th>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {data.deliveries.deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.created_at}</td>
                  <td>{delivery.event_type}</td>
                  <td>{delivery.status}</td>
                  <td>{delivery.last_response_status ?? "—"}</td>
                  <td>{delivery.attempt_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
