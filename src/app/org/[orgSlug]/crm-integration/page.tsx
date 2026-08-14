import { listConnections } from "@/modules/integrations/connections";
import { listFieldMappings } from "@/modules/integrations/field-mappings";
import { ConnectForm } from "./connect-form";
import { ConnectionActions } from "./connection-actions";
import { FieldMappingForm } from "./field-mapping-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

export default async function CrmIntegrationPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [connections, loadError] = await listConnections(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !connections) {
    return (
      <PageContainer>
        <PageTitle>CRM integration</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError}
        </p>
      </PageContainer>
    );
  }

  const fieldMappingsByConnection = await Promise.all(
    connections.map((connection) => listFieldMappings(orgSlug, connection.id)),
  );

  return (
    <PageContainer>
      <PageTitle>CRM integration</PageTitle>
      <p className="text-sm text-muted">
        Synchronizes routed leads to one connected CRM: creates/updates the contact,
        assigns ownership, sends source information and mapped custom variables, adds the
        routing explanation as a note, and pushes the accepted assignment status. Does not
        sync calls, SMS, email conversations, appointments, or historical CRM activity.
      </p>

      {connections.length === 0 ? (
        <p className="text-sm text-muted">No CRM connected yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {connections.map((connection, index) => (
            <Card key={connection.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{connection.provider}</span>
                <StatusBadge status={connection.status} />
                {connection.connected_at ? (
                  <span className="text-muted">connected {connection.connected_at}</span>
                ) : null}
              </div>
              <ConnectionActions orgSlug={orgSlug} connectionId={connection.id} />

              <p className="text-sm font-medium">Field mappings</p>
              {fieldMappingsByConnection[index]!.length === 0 ? (
                <p className="text-sm text-muted">No field mappings configured.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {fieldMappingsByConnection[index]!.map((mapping) => (
                    <li key={mapping.id}>
                      {mapping.source_field} → {mapping.crm_field}
                      {mapping.transformation ? ` (${mapping.transformation})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <FieldMappingForm orgSlug={orgSlug} connectionId={connection.id} />
            </Card>
          ))}
        </div>
      )}

      <Section title="Connect a CRM">
        <ConnectForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
