import { listWebhookEndpoints } from "@/modules/webhooks/endpoints";
import { CreateEndpointForm } from "./create-endpoint-form";
import { EndpointActions } from "./endpoint-actions";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Outbound webhooks</h1>
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Outbound webhooks</h1>
      <p>
        Every delivery is signed (HMAC-SHA256) and carries a unique event id for
        replay-protected, idempotent delivery. Failed deliveries retry on a schedule (1m,
        5m, 30m, 2h, 12h) and can be retried manually from Integration logs.
      </p>

      {endpoints.length === 0 ? (
        <p>No webhook endpoints configured.</p>
      ) : (
        <ul>
          {endpoints.map((endpoint) => (
            <li key={endpoint.id}>
              <p>
                {endpoint.url} — {endpoint.status}
              </p>
              <p>Subscribed to: {endpoint.subscribed_events.join(", ") || "(none)"}</p>
              <EndpointActions
                orgSlug={orgSlug}
                endpointId={endpoint.id}
                status={endpoint.status}
              />
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2>Add an endpoint</h2>
        <CreateEndpointForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
