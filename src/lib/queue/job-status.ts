import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Checks whether a job's side effects already completed — the same
 * redelivery-idempotency guard as Milestone 6's notification consumer
 * (see that module's JobStatusChecker for the full rationale). Generic
 * across queues since `integration_jobs` is the shared ledger for all of
 * them.
 */
export interface JobStatusChecker {
  isCompleted(jobId: string): Promise<boolean>;
}

export class SupabaseJobStatusChecker implements JobStatusChecker {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async isCompleted(jobId: string): Promise<boolean> {
    const { data } = await this.client
      .from("integration_jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    return data?.status === "completed";
  }
}

export class TestJobStatusChecker implements JobStatusChecker {
  private readonly completed = new Set<string>();

  markCompleted(jobId: string): void {
    this.completed.add(jobId);
  }

  async isCompleted(jobId: string): Promise<boolean> {
    await Promise.resolve();
    return this.completed.has(jobId);
  }
}
