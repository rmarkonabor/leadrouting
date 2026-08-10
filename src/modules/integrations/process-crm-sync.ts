import type { QueueAdapter, QueueMessage } from "@/lib/queue/integration-queue-adapter";
import type { JobStatusChecker } from "@/lib/queue/job-status";
import type { CrmAdapter } from "./crm-adapter";
import type { CrmSyncRepository } from "./crm-sync-repository";

export interface ProcessCrmSyncDeps {
  repository: CrmSyncRepository;
  queue: QueueAdapter;
  jobStatus: JobStatusChecker;
  createAdapter: (provider: string) => CrmAdapter;
  captureException?: (error: unknown, context: { jobId: string }) => void;
}

export interface ProcessBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Processes one batch of the crm_sync queue. Idempotent by construction:
 * (1) the producer's dedupe key prevents a duplicate enqueue for the same
 * logical event; (2) `external_record_links`' unique constraints (mirrored
 * exactly by `TestCrmSyncRepository` for tests) prevent a retried
 * `sync_contact` job from ever creating a second CRM contact for the same
 * lead (spec §42 item 10) — a retry upserts the same link row instead. A
 * failure syncing to one connection never blocks another connection or the
 * rest of the batch.
 */
export async function processCrmSyncBatch(
  deps: ProcessCrmSyncDeps,
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
  deps: ProcessCrmSyncDeps,
  message: QueueMessage,
): Promise<void> {
  if (await deps.jobStatus.isCompleted(message.jobId)) {
    return;
  }

  const jobType = String(message.payload.job_type ?? "");
  const leadId = String(message.payload.lead_id ?? "");
  if (!leadId) {
    throw new Error(`crm_sync job ${message.jobId} has no lead_id in its payload.`);
  }

  const organizationId = await deps.repository.getLeadOrganizationId(leadId);
  if (!organizationId) {
    throw new Error(`Lead ${leadId} not found for crm_sync job ${message.jobId}.`);
  }

  const connections = await deps.repository.getConnectedConnections(organizationId);

  for (const connection of connections) {
    const adapter = deps.createAdapter(connection.provider);
    await adapter.connect(connection.settings, connection.credentials);

    const refreshed = await adapter.refreshCredentials();
    if (refreshed) {
      await deps.repository.updateConnectionCredentials(connection.id, refreshed);
    }

    if (jobType === "sync_contact") {
      const { contact, ownerCrmExternalId, explanationNote } =
        await deps.repository.buildSyncContactPayload(connection.id, leadId);

      const { result, requestSummary, responseSummary } =
        await adapter.createOrUpdateContact(contact);

      if (!responseSummary.ok) {
        await deps.repository.writeLog({
          organizationId,
          integrationJobId: message.jobId,
          provider: connection.provider,
          eventType: jobType,
          leadId,
          status: "failed",
          requestSummary,
          responseSummary,
        });
        throw new Error(
          `CRM createOrUpdateContact failed: ${responseSummary.errorMessage}`,
        );
      }

      await deps.repository.upsertExternalRecordLink({
        organizationId,
        connectionId: connection.id,
        leadId,
        provider: connection.provider,
        externalRecordId: result.externalRecordId,
      });

      if (ownerCrmExternalId) {
        await adapter.assignOwner(result.externalRecordId, ownerCrmExternalId);
      }
      if (explanationNote) {
        await adapter.createNote(result.externalRecordId, explanationNote);
      }

      await deps.repository.writeLog({
        organizationId,
        integrationJobId: message.jobId,
        provider: connection.provider,
        eventType: jobType,
        leadId,
        status: "completed",
        requestSummary,
        responseSummary,
      });
    } else if (jobType === "sync_accepted_status") {
      const externalRecordId = await deps.repository.getExternalRecordId(
        connection.id,
        leadId,
      );

      if (!externalRecordId) {
        // No linked contact yet — nothing to push a status update to. Not
        // an error: sync_contact for this lead may simply not have run yet.
        continue;
      }

      const { requestSummary, responseSummary } = await adapter.updateStatus(
        externalRecordId,
        "accepted",
      );

      await deps.repository.writeLog({
        organizationId,
        integrationJobId: message.jobId,
        provider: connection.provider,
        eventType: jobType,
        leadId,
        status: responseSummary.ok ? "completed" : "failed",
        requestSummary,
        responseSummary,
      });

      if (!responseSummary.ok) {
        throw new Error(`CRM updateStatus failed: ${responseSummary.errorMessage}`);
      }
    }
  }
}
