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
 * Abstraction over the assignment_notifications pgmq queue. The Supabase
 * implementation is a thin wrapper over the `dequeue_assignment_notifications`
 * / `ack_assignment_notification` / `fail_assignment_notification` RPCs
 * (pgmq's own functions live in the `pgmq` schema and aren't exposed
 * directly over PostgREST — see docs/decisions.md ADR-042). `TestQueueAdapter`
 * is an in-memory double so the consumer's idempotency/retry/dead-letter
 * logic is fully unit-testable without pgmq being installed anywhere.
 */
export interface QueueAdapter {
  dequeueBatch(batchSize: number): Promise<QueueMessage[]>;
  ack(message: QueueMessage): Promise<void>;
  fail(message: QueueMessage, error: string): Promise<void>;
}

export class SupabaseQueueAdapter implements QueueAdapter {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async dequeueBatch(batchSize: number): Promise<QueueMessage[]> {
    const { data, error } = await this.client.rpc("dequeue_assignment_notifications", {
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
    const { error } = await this.client.rpc("ack_assignment_notification", {
      p_msg_id: message.msgId,
      p_job_id: message.jobId,
    });
    if (error) throw error;
  }

  async fail(message: QueueMessage, errorMessage: string): Promise<void> {
    const { error } = await this.client.rpc("fail_assignment_notification", {
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
    // Simulates pgmq's visibility-timeout redelivery: a failed message goes
    // back on the queue for a later dequeue, same as production.
    this.queue.push(message);
    await Promise.resolve();
  }
}
