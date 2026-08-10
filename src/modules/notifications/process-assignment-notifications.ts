import type { QueueAdapter, QueueMessage } from "./queue-adapter";
import type { EmailAdapter } from "./email-adapter";
import type {
  NotificationContentResolver,
  ResolvedNotification,
} from "./content-resolver";

export interface NotificationRecorder {
  record(notification: ResolvedNotification): Promise<void>;
}

/**
 * Checks whether a job's side effects (notification recorded, email sent)
 * have already completed. This is what makes the consumer idempotent
 * against true message *redelivery* — not just against duplicate
 * *enqueue* (which the integration_jobs dedupe key already prevents at
 * the producer). pgmq is at-least-once: if a prior delivery of this exact
 * message crashed after doing its work but before acking, the message
 * reappears after its visibility timeout. Without this check that
 * redelivery would resolve content and send/record a second time.
 */
export interface JobStatusChecker {
  isCompleted(jobId: string): Promise<boolean>;
}

export interface ProcessBatchDeps {
  queue: QueueAdapter;
  email: EmailAdapter;
  resolver: NotificationContentResolver;
  recorder: NotificationRecorder;
  jobStatus: JobStatusChecker;
  /**
   * Called for any unexpected processor failure (spec requirement:
   * "Sentry monitoring for unexpected processor failures"). Never receives
   * the message payload itself — only the job id — so a lead's personal
   * data can never reach Sentry through this path (CLAUDE.md rule 18).
   */
  captureException?: (error: unknown, context: { jobId: string }) => void;
}

export interface ProcessBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Processes one batch of the assignment_notifications queue. Idempotent by
 * construction at two levels: (1) a message's `job_id` maps to an
 * `integration_jobs` row created with an ON CONFLICT DO NOTHING dedupe key
 * (docs/background-processing.md §4), so redelivery of the same logical
 * event never produces a second in-app notification or email; (2) this
 * function itself has no side effect that isn't safe to repeat — resolving
 * content is a pure read, recording a notification / sending an email are
 * both safe to attempt again if a prior attempt's ack was lost (the
 * consumer would just create one more notification row on that rare
 * double-send, which is an acceptable, documented tradeoff of at-least-once
 * delivery — see ADR-043 for why exactly-once notification delivery is not
 * guaranteed and does not need to be for this feature).
 *
 * A failure processing one message never blocks the batch: it's recorded
 * via `queue.fail` (increments attempt_count, schedules retry or moves to
 * dead_letter) and processing continues with the next message.
 */
export async function processAssignmentNotificationBatch(
  deps: ProcessBatchDeps,
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

async function processOne(deps: ProcessBatchDeps, message: QueueMessage): Promise<void> {
  if (await deps.jobStatus.isCompleted(message.jobId)) {
    // A previous delivery of this exact message already did the work;
    // this is a pgmq redelivery (visibility timeout), not a new event.
    // Acking (in the caller) just clears it from the queue.
    return;
  }

  const eventType = String(message.payload.event_type ?? "");
  const recipients = await deps.resolver.resolve(eventType, message.payload);

  for (const recipient of recipients) {
    await deps.recorder.record(recipient);
    if (recipient.email) {
      await deps.email.send({
        to: recipient.email,
        subject: recipient.title,
        body: recipient.body,
      });
    }
  }
}
