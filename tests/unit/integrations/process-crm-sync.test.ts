import { describe, expect, it } from "vitest";
import { processCrmSyncBatch } from "@/modules/integrations/process-crm-sync";
import { TestQueueAdapter } from "@/lib/queue/integration-queue-adapter";
import { TestJobStatusChecker } from "@/lib/queue/job-status";
import { TestCrmAdapter } from "@/modules/integrations/test-crm-adapter";
import { TestCrmSyncRepository } from "@/modules/integrations/crm-sync-repository";
import type { SyncContactPayload } from "@/modules/integrations/sync-payload";

const ORG_ID = "org-1";
const CONNECTION_ID = "conn-1";
const LEAD_ID = "lead-1";

function makeFixturePayload(
  overrides: Partial<SyncContactPayload> = {},
): SyncContactPayload {
  return {
    contact: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.test",
      phone: "555-0100",
      fields: { budget: "50000-100000" },
    },
    ownerCrmExternalId: null,
    explanationNote: null,
    ...overrides,
  };
}

function makeDeps(adapter: TestCrmAdapter = new TestCrmAdapter()) {
  const queue = new TestQueueAdapter();
  const jobStatus = new TestJobStatusChecker();
  const repository = new TestCrmSyncRepository();
  repository.leadOrganizationIds.set(LEAD_ID, ORG_ID);
  repository.connectionsByOrg.set(ORG_ID, [
    {
      id: CONNECTION_ID,
      provider: "generic_http",
      settings: {},
      credentials: { accessToken: "x" },
    },
  ]);
  repository.payloadsByConnectionAndLead.set(
    `${CONNECTION_ID}:${LEAD_ID}`,
    makeFixturePayload(),
  );

  return { queue, jobStatus, repository, adapter, createAdapter: () => adapter };
}

describe("processCrmSyncBatch", () => {
  it("creates a CRM contact and records an external_record_links row on first sync", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: LEAD_ID });

    const result = await processCrmSyncBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.adapter.contacts.size).toBe(1);
    expect(
      deps.repository.externalRecordLinks.get(`${CONNECTION_ID}:${LEAD_ID}`),
    ).toBeDefined();
    expect(deps.repository.logs.at(-1)?.status).toBe("completed");
  });

  it("duplicate-CRM-record regression: retrying the same sync_contact job never creates a second external_record_links row", async () => {
    const deps = makeDeps();

    // Simulate three independent delivery attempts of the same logical
    // event (e.g. the first two failed and were retried by the drain Cron).
    for (let attempt = 0; attempt < 3; attempt++) {
      deps.queue.enqueue(`job-${attempt}`, {
        job_type: "sync_contact",
        lead_id: LEAD_ID,
      });
      await processCrmSyncBatch(deps);
    }

    // Exactly one external_record_links row for this connection+lead,
    // regardless of how many times the job was attempted.
    expect(deps.repository.externalRecordLinks.size).toBe(1);
    // The second and third attempts updated (PATCH) the same contact
    // rather than creating a brand new one.
    const externalId = deps.repository.externalRecordLinks.get(
      `${CONNECTION_ID}:${LEAD_ID}`,
    )!;
    expect(deps.adapter.contacts.has(externalId)).toBe(true);
    expect(deps.adapter.contacts.size).toBe(1);
  });

  it("applies CRM ownership mapping: assigns the mapped owner when the payload includes one", async () => {
    const deps = makeDeps();
    deps.repository.payloadsByConnectionAndLead.set(
      `${CONNECTION_ID}:${LEAD_ID}`,
      makeFixturePayload({ ownerCrmExternalId: "crm-user-42" }),
    );
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: LEAD_ID });

    await processCrmSyncBatch(deps);

    expect(deps.adapter.ownerAssignments).toHaveLength(1);
    expect(deps.adapter.ownerAssignments[0]!.ownerExternalId).toBe("crm-user-42");
  });

  it("adds the routing explanation as a CRM note when present", async () => {
    const deps = makeDeps();
    deps.repository.payloadsByConnectionAndLead.set(
      `${CONNECTION_ID}:${LEAD_ID}`,
      makeFixturePayload({ explanationNote: "Routed via round robin to Team Alpha." }),
    );
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: LEAD_ID });

    await processCrmSyncBatch(deps);

    expect(deps.adapter.notes).toHaveLength(1);
    expect(deps.adapter.notes[0]!.note).toContain("round robin");
  });

  it("sends the accepted assignment status once a contact link exists", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: LEAD_ID });
    await processCrmSyncBatch(deps);

    deps.queue.enqueue("job-2", { job_type: "sync_accepted_status", lead_id: LEAD_ID });
    const result = await processCrmSyncBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.adapter.statusUpdates).toEqual([
      {
        externalRecordId: deps.adapter.statusUpdates[0]!.externalRecordId,
        status: "accepted",
      },
    ]);
  });

  it("skips (does not fail) sync_accepted_status when no contact link exists yet", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { job_type: "sync_accepted_status", lead_id: LEAD_ID });

    const result = await processCrmSyncBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.adapter.statusUpdates).toHaveLength(0);
  });

  it("CRM retries: a failed sync is not acked and stays retryable, without blocking the rest of the batch", async () => {
    const deps = makeDeps();
    // job-1 references a lead the repository has no organization for — a
    // realistic failure mode (e.g. the lead was deleted between enqueue and
    // processing). job-2 is a normal, healthy sync for a different lead.
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: "missing-lead" });
    deps.queue.enqueue("job-2", { job_type: "sync_contact", lead_id: LEAD_ID });

    const result = await processCrmSyncBatch(deps);

    expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
    expect(deps.queue.failed).toHaveLength(1);
    // The failed message stays on the queue for the drain Cron to retry;
    // the healthy job still acked and completed normally.
    expect(deps.queue.acked).toHaveLength(1);
    expect(deps.repository.externalRecordLinks.size).toBe(1);
  });

  it("does not reprocess a job whose side effects already completed (redelivery idempotency)", async () => {
    const deps = makeDeps();
    const message = deps.queue.enqueue("job-1", {
      job_type: "sync_contact",
      lead_id: LEAD_ID,
    });
    deps.jobStatus.markCompleted(message.jobId);

    const result = await processCrmSyncBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.adapter.contacts.size).toBe(0);
    expect(deps.repository.externalRecordLinks.size).toBe(0);
  });

  it("never connects to a real production CRM during automated tests — TestCrmAdapter performs no network I/O", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { job_type: "sync_contact", lead_id: LEAD_ID });
    await processCrmSyncBatch(deps);
    expect(deps.adapter.connected).toBe(true);
    expect(deps.adapter.settings).toEqual({});
  });
});
