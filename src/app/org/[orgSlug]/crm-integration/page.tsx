import { listConnections } from "@/modules/integrations/connections";
import { listFieldMappings } from "@/modules/integrations/field-mappings";
import { ConnectForm } from "./connect-form";
import { ConnectionActions } from "./connection-actions";
import { FieldMappingForm } from "./field-mapping-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>CRM integration</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  const fieldMappingsByConnection = await Promise.all(
    connections.map((connection) => listFieldMappings(orgSlug, connection.id)),
  );

  return (
    <main>
      <h1>CRM integration</h1>
      <p>
        Synchronizes routed leads to one connected CRM: creates/updates the contact,
        assigns ownership, sends source information and mapped custom variables, adds the
        routing explanation as a note, and pushes the accepted assignment status. Does not
        sync calls, SMS, email conversations, appointments, or historical CRM activity.
      </p>

      {connections.length === 0 ? (
        <p>No CRM connected yet.</p>
      ) : (
        <ul>
          {connections.map((connection, index) => (
            <li key={connection.id}>
              <p>
                {connection.provider} — {connection.status}
                {connection.connected_at ? ` (connected ${connection.connected_at})` : ""}
              </p>
              <ConnectionActions orgSlug={orgSlug} connectionId={connection.id} />

              <h3>Field mappings</h3>
              {fieldMappingsByConnection[index]!.length === 0 ? (
                <p>No field mappings configured.</p>
              ) : (
                <ul>
                  {fieldMappingsByConnection[index]!.map((mapping) => (
                    <li key={mapping.id}>
                      {mapping.source_field} → {mapping.crm_field}
                      {mapping.transformation ? ` (${mapping.transformation})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <FieldMappingForm orgSlug={orgSlug} connectionId={connection.id} />
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2>Connect a CRM</h2>
        <ConnectForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
