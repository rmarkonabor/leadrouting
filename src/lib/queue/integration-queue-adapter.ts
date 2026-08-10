import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface QueueMessage {
  msgId: number;
  jobId: string;
  payload: Record<string, unknown>;
  readCount: number;
}

/**
 * Abstraction over one queue backed by the shared `integration_jobs` table
 * (docs/background-processing.md), parameterized by queue name so the same
 * adapter class serves both `crm_sync` and `outbound_webhooks` — unlike
 * Milestone 6's `assignment_notifications`-specific adapter, which had a
 * single queue to worry about. `dequeue_integration_jobs` /
 * `ack_integration_job` / `fail_integration_job` are the generic RPCs
 * (Milestone 8 migration); pgmq itself is never touched directly, same
 * reasoning as ADR-042.
 */
export interface QueueAdapter {
  dequeueBatch(batchSize: number): Promise<QueueMessage[]>;
  ack(message: QueueMessage): Promise<void>;
  fail(message: QueueMessage, error: string): Promise<void>;
}

export class SupabaseIntegrationQueueAdapter implements QueueAdapter {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly queueName: string,
  ) {}

  async dequeueBatch(batchSize: number): Promise<QueueMessage[]> {
    const { data, error } = await this.client.rpc("dequeue_integration_jobs", {
      p_queue_name: this.queueName,
      p_batch_size: batchSize,
    });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      msgId: row.msg_id,
      jobId: String(row.payload.job_id),
      payload: row.payload,
      readCount: row.read_ct,
    }));
  }

  async ack(message: QueueMessage): Promise<void> {
    const { error } = await this.client.rpc("ack_integration_job", {
      p_queue_name: this.queueName,
      p_msg_id: message.msgId,
      p_job_id: message.jobId,
    });
    if (error) throw error;
  }

  async fail(message: QueueMessage, errorMessage: string): Promise<void> {
    const { error } = await this.client.rpc("fail_integration_job", {
      p_queue_name: this.queueName,
      p_msg_id: message.msgId,
      p_job_id: message.jobId,
      p_error: errorMessage,
    });
    if (error) throw error;
  }
}

export class TestQueueAdapter implements QueueAdapter {
  private nextMsgId = 1;
  readonly queue: QueueMessage[] = [];
  readonly acked: QueueMessage[] = [];
  readonly failed: Array<{ message: QueueMessage; error: string }> = [];

  enqueue(jobId: string, payload: Record<string, unknown>): QueueMessage {
    const message: QueueMessage = {
      msgId: this.nextMsgId++,
      jobId,
      payload,
      readCount: 0,
    };
    this.queue.push(message);
    return message;
  }

  async dequeueBatch(batchSize: number): Promise<QueueMessage[]> {
    const batch = this.queue.splice(0, batchSize);
    batch.forEach((m) => m.readCount++);
    await Promise.resolve();
    return batch;
  }

  async ack(message: QueueMessage): Promise<void> {
    this.acked.push(message);
    await Promise.resolve();
  }

  async fail(message: QueueMessage, error: string): Promise<void> {
    this.failed.push({ message, error });
    // Unlike assignment_notifications' TestQueueAdapter, a failed message is
    // NOT re-queued here: real crm_sync/outbound_webhooks retries are
    // human-scale delays drained by Cron, not immediate pgmq redelivery
    // (see fail_integration_job's comment in the Milestone 8 migration).
    await Promise.resolve();
  }
}
