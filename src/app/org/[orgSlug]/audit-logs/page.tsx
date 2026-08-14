import { listAuditLogs } from "@/modules/audit-logs/audit-logs";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/Table";

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
      <PageContainer>
        <PageTitle>Audit logs</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError ?? "Something went wrong loading audit logs."}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Audit logs</PageTitle>
      {result.logs.length === 0 ? (
        <p className="text-sm text-muted">No audit log entries.</p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell>Entity</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.logs.map((log) => (
              <TableRow key={String(log.id)}>
                <TableCell>{String(log.created_at)}</TableCell>
                <TableCell>{String(log.actor_user_id ?? "—")}</TableCell>
                <TableCell>{String(log.action)}</TableCell>
                <TableCell>
                  {String(log.entity_type)}
                  {log.entity_id ? ` (${String(log.entity_id)})` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-sm text-muted">
        Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))} (
        {result.total} total)
      </p>
    </PageContainer>
  );
}
