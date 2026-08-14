import { listWebhookEndpoints } from "@/modules/webhooks/endpoints";
import { CreateEndpointForm } from "./create-endpoint-form";
import { EndpointActions } from "./endpoint-actions";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

export default async function WebhooksPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [endpoints, loadError] = await listWebhookEndpoints(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !endpoints) {
    return (
      <PageContainer>
        <PageTitle>Outbound webhooks</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Outbound webhooks</PageTitle>
      <p className="text-sm text-muted">
        Every delivery is signed (HMAC-SHA256) and carries a unique event id for
        replay-protected, idempotent delivery. Failed deliveries retry on a schedule (1m,
        5m, 30m, 2h, 12h) and can be retried manually from Integration logs.
      </p>

      {endpoints.length === 0 ? (
        <p className="text-sm text-muted">No webhook endpoints configured.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium break-all">{endpoint.url}</span>
                <StatusBadge status={endpoint.status} />
              </div>
              <p className="text-sm text-muted">
                Subscribed to: {endpoint.subscribed_events.join(", ") || "(none)"}
              </p>
              <EndpointActions
                orgSlug={orgSlug}
                endpointId={endpoint.id}
                status={endpoint.status}
              />
            </Card>
          ))}
        </div>
      )}

      <Section title="Add an endpoint">
        <CreateEndpointForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
