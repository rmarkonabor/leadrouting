import type { QueueAdapter, QueueMessage } from "@/lib/queue/integration-queue-adapter";
import type { JobStatusChecker } from "@/lib/queue/job-status";
import type { HttpDeliverer } from "./http-deliverer";
import type { WebhookRepository } from "./webhook-repository";
import { signPayload } from "./signing";

export interface ProcessOutboundWebhooksDeps {
  repository: WebhookRepository;
  queue: QueueAdapter;
  jobStatus: JobStatusChecker;
  deliverer: HttpDeliverer;
  captureException?: (error: unknown, context: { jobId: string }) => void;
}

export interface ProcessBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Processes one batch of the outbound_webhooks queue. `event_id` is the
 * integration_jobs row id (one job = one logical event) — `webhook_
 * deliveries`' unique (webhook_endpoint_id, event_id) constraint (mirrored
 * exactly by `TestWebhookRepository` for tests) is both the replay-
 * protection and idempotent-delivery mechanism (spec §43 requirements
 * 2/3): a retried job skips any endpoint that already shows `delivered`
 * for this event_id and only (re)attempts the rest, so a job with three
 * subscribed endpoints where one failed retries only that one.
 */
export async function processOutboundWebhookBatch(
  deps: ProcessOutboundWebhooksDeps,
  batchSize = 10,
): Promise<ProcessBatchResult> {
  const messages = await deps.queue.dequeueBatch(batchSize);
  let succeeded = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      await processOne(deps, message);
      await deps.queue.ack(message);
      succeeded++;
    } catch (error) {
      failed++;
      deps.captureException?.(error, { jobId: message.jobId });
      await deps.queue.fail(
        message,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { processed: messages.length, succeeded, failed };
}

async function processOne(
  deps: ProcessOutboundWebhooksDeps,
  message: QueueMessage,
): Promise<void> {
  if (await deps.jobStatus.isCompleted(message.jobId)) {
    return;
  }

  const eventType = String(message.payload.event_type ?? "");
  const leadId =
    typeof message.payload.lead_id === "string" ? message.payload.lead_id : null;
  if (!leadId) {
    throw new Error(
      `outbound_webhooks job ${message.jobId} has no lead_id in its payload.`,
    );
  }

  const organizationId = await deps.repository.getLeadOrganizationId(leadId);
  if (!organizationId) {
    throw new Error(
      `Lead ${leadId} not found for outbound_webhooks job ${message.jobId}.`,
    );
  }

  const endpoints = await deps.repository.getSubscribedEndpoints(
    organizationId,
    eventType,
  );
  if (endpoints.length === 0) {
    return;
  }

  const payload = await deps.repository.buildEventPayload(
    message.jobId,
    eventType,
    organizationId,
    message.payload,
  );
  const payloadJson = JSON.stringify(payload);

  const failures: string[] = [];

  for (const endpoint of endpoints) {
    if (await deps.repository.isAlreadyDelivered(endpoint.id, message.jobId)) {
      continue;
    }

    const signature = signPayload(payloadJson, endpoint.secret);

    const result = await deps.deliverer.post(
      endpoint.url,
      {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-webhook-event-id": message.jobId,
      },
      payloadJson,
    );

    await deps.repository.recordDelivery({
      organizationId,
      endpointId: endpoint.id,
      integrationJobId: message.jobId,
      eventId: message.jobId,
      eventType,
      payload: payload as unknown as Record<string, unknown>,
      delivered: result.ok,
      responseStatus: result.status,
    });

    if (!result.ok) {
      failures.push(`${endpoint.url} responded ${result.status}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Webhook delivery failed for: ${failures.join("; ")}`);
  }
}
