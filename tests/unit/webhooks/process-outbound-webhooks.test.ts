import { describe, expect, it } from "vitest";
import { processOutboundWebhookBatch } from "@/modules/webhooks/process-outbound-webhooks";
import { TestQueueAdapter } from "@/lib/queue/integration-queue-adapter";
import { TestJobStatusChecker } from "@/lib/queue/job-status";
import { TestHttpDeliverer } from "@/modules/webhooks/http-deliverer";
import { TestWebhookRepository } from "@/modules/webhooks/webhook-repository";
import type { WebhookEventPayload } from "@/modules/webhooks/build-event-payload";

const ORG_ID = "org-1";
const LEAD_ID = "lead-1";
const ENDPOINT_A = {
  id: "endpoint-a",
  url: "https://a.example.test/hooks",
  secret: "secret-a",
};
const ENDPOINT_B = {
  id: "endpoint-b",
  url: "https://b.example.test/hooks",
  secret: "secret-b",
};

function fixturePayload(eventId: string): WebhookEventPayload {
  return {
    eventId,
    eventType: "lead.created",
    organizationId: ORG_ID,
    timestamp: "2026-01-01T00:00:00.000Z",
    lead: { id: LEAD_ID, email: "lead@example.test" },
    customVariables: {},
    assignment: null,
  };
}

function makeDeps(deliverer: TestHttpDeliverer = new TestHttpDeliverer()) {
  const queue = new TestQueueAdapter();
  const jobStatus = new TestJobStatusChecker();
  const repository = new TestWebhookRepository();
  repository.leadOrganizationIds.set(LEAD_ID, ORG_ID);
  return { queue, jobStatus, repository, deliverer };
}

describe("processOutboundWebhookBatch", () => {
  it("delivers a signed payload to every endpoint subscribed to the event", async () => {
    const deps = makeDeps();
    deps.repository.endpointsByOrgAndEvent.set(`${ORG_ID}:lead.created`, [
      ENDPOINT_A,
      ENDPOINT_B,
    ]);
    deps.repository.payloadsByEventId.set("job-1", fixturePayload("job-1"));
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });

    const result = await processOutboundWebhookBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.deliverer.requests).toHaveLength(2);
    // Unique event identifier + signature headers present on every delivery.
    for (const request of deps.deliverer.requests) {
      expect(request.headers["x-webhook-event-id"]).toBe("job-1");
      expect(request.headers["x-webhook-signature"]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("only delivers to endpoints subscribed to this event type", async () => {
    const deps = makeDeps();
    deps.repository.endpointsByOrgAndEvent.set(`${ORG_ID}:lead.created`, [ENDPOINT_A]);
    // ENDPOINT_B is not subscribed to lead.created — never queried/delivered.
    deps.repository.payloadsByEventId.set("job-1", fixturePayload("job-1"));
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });

    await processOutboundWebhookBatch(deps);

    expect(deps.deliverer.requests).toHaveLength(1);
    expect(deps.deliverer.requests[0]!.url).toBe(ENDPOINT_A.url);
  });

  it("replay protection / idempotent delivery: does not redeliver to an endpoint that already received this event", async () => {
    const deps = makeDeps();
    deps.repository.endpointsByOrgAndEvent.set(`${ORG_ID}:lead.created`, [ENDPOINT_A]);
    deps.repository.payloadsByEventId.set("job-1", fixturePayload("job-1"));
    deps.repository.deliveredEvents.add(`${ENDPOINT_A.id}:job-1`);
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });

    const result = await processOutboundWebhookBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.deliverer.requests).toHaveLength(0);
  });

  it("webhook retries: retries only the endpoint that failed, not one that already succeeded", async () => {
    const deliverer = new TestHttpDeliverer();
    const deps = makeDeps(deliverer);
    deps.repository.endpointsByOrgAndEvent.set(`${ORG_ID}:lead.created`, [
      ENDPOINT_A,
      ENDPOINT_B,
    ]);
    deps.repository.payloadsByEventId.set("job-1", fixturePayload("job-1"));

    deliverer.nextResult = { status: 500, ok: false };
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });
    const firstAttempt = await processOutboundWebhookBatch(deps);

    expect(firstAttempt.failed).toBe(1);
    expect(deps.deliverer.requests).toHaveLength(2); // both endpoints attempted
    // Manually mark endpoint A as having succeeded on the failed attempt
    // (mixed outcome), matching what recordDelivery would have done.
    deps.repository.deliveredEvents.add(`${ENDPOINT_A.id}:job-1`);

    deliverer.nextResult = { status: 200, ok: true };
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });
    const retryAttempt = await processOutboundWebhookBatch(deps);

    expect(retryAttempt).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    // Only endpoint B was retried — 2 (first attempt) + 1 (retry) = 3 total.
    expect(deps.deliverer.requests).toHaveLength(3);
    expect(deps.deliverer.requests[2]!.url).toBe(ENDPOINT_B.url);
  });

  it("does nothing (succeeds trivially) when no endpoint is subscribed to the event", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { event_type: "lead.created", lead_id: LEAD_ID });

    const result = await processOutboundWebhookBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.deliverer.requests).toHaveLength(0);
  });

  it("does not redeliver a job whose side effects already completed", async () => {
    const deps = makeDeps();
    deps.repository.endpointsByOrgAndEvent.set(`${ORG_ID}:lead.created`, [ENDPOINT_A]);
    deps.repository.payloadsByEventId.set("job-1", fixturePayload("job-1"));
    const message = deps.queue.enqueue("job-1", {
      event_type: "lead.created",
      lead_id: LEAD_ID,
    });
    deps.jobStatus.markCompleted(message.jobId);

    const result = await processOutboundWebhookBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.deliverer.requests).toHaveLength(0);
  });
});
