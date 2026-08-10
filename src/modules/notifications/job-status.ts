import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { JobStatusChecker } from "./process-assignment-notifications";

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
