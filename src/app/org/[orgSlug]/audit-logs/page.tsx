import { listAuditLogs } from "@/modules/audit-logs/audit-logs";
import { toAppError } from "@/lib/errors/app-error";

export default async function AuditLogsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [result, loadError] = await listAuditLogs(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !result) {
    return (
      <main>
        <h1>Audit logs</h1>
        <p role="alert">{loadError ?? "Something went wrong loading audit logs."}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Audit logs</h1>
      {result.logs.length === 0 ? (
        <p>No audit log entries.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {result.logs.map((log) => (
              <tr key={String(log.id)}>
                <td>{String(log.created_at)}</td>
                <td>{String(log.actor_user_id ?? "—")}</td>
                <td>{String(log.action)}</td>
                <td>
                  {String(log.entity_type)}
                  {log.entity_id ? ` (${String(log.entity_id)})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))} (
        {result.total} total)
      </p>
    </main>
  );
}
