import { describe, expect, it } from "vitest";
import { processAssignmentNotificationBatch } from "@/modules/notifications/process-assignment-notifications";
import { TestQueueAdapter } from "@/modules/notifications/queue-adapter";
import { TestEmailAdapter } from "@/modules/notifications/email-adapter";
import { TestJobStatusChecker } from "@/modules/notifications/job-status";
import type {
  NotificationContentResolver,
  ResolvedNotification,
} from "@/modules/notifications/content-resolver";
import type { NotificationRecorder } from "@/modules/notifications/process-assignment-notifications";

class FakeResolver implements NotificationContentResolver {
  calls = 0;
  async resolve(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<ResolvedNotification[]> {
    this.calls++;
    await Promise.resolve();
    if (eventType === "unknown_event") return [];
    return [
      {
        organizationId: "org-1",
        userId: String(payload.user_id ?? "user-1"),
        email: "agent@example.test",
        eventType,
        leadId: String(payload.lead_id ?? "lead-1"),
        assignmentId: String(payload.assignment_id ?? "assignment-1"),
        title: "New lead assigned to you",
        body: "You have a new lead assignment.",
      },
    ];
  }
}

class FakeRecorder implements NotificationRecorder {
  recorded: ResolvedNotification[] = [];
  async record(notification: ResolvedNotification): Promise<void> {
    this.recorded.push(notification);
    await Promise.resolve();
  }
}

class ThrowingResolver implements NotificationContentResolver {
  async resolve(): Promise<ResolvedNotification[]> {
    throw new Error("boom");
  }
}

function makeDeps(resolver: NotificationContentResolver = new FakeResolver()) {
  const queue = new TestQueueAdapter();
  const email = new TestEmailAdapter();
  const recorder = new FakeRecorder();
  const jobStatus = new TestJobStatusChecker();
  return { queue, email, resolver, recorder, jobStatus };
}

describe("processAssignmentNotificationBatch", () => {
  it("records a notification and sends an email for a queued job", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", {
      event_type: "new_lead_assignment",
      assignment_id: "a1",
      user_id: "u1",
      lead_id: "l1",
    });

    const result = await processAssignmentNotificationBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.recorder.recorded).toHaveLength(1);
    expect(deps.email.sent).toHaveLength(1);
    expect(deps.queue.acked).toHaveLength(1);
  });

  it("does not reprocess a message whose job is already completed (repeated job delivery)", async () => {
    const deps = makeDeps();
    const message = deps.queue.enqueue("job-1", {
      event_type: "new_lead_assignment",
      assignment_id: "a1",
      user_id: "u1",
    });
    deps.jobStatus.markCompleted(message.jobId);

    const result = await processAssignmentNotificationBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    // Skipped the actual side effects — already done by an earlier delivery.
    expect(deps.recorder.recorded).toHaveLength(0);
    expect(deps.email.sent).toHaveLength(0);
    // Still acked, so the redelivered message is cleared from the queue.
    expect(deps.queue.acked).toHaveLength(1);
  });

  it("does not send real email during tests — TestEmailAdapter never performs network I/O", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", {
      event_type: "new_lead_assignment",
      assignment_id: "a1",
      user_id: "u1",
    });

    await processAssignmentNotificationBatch(deps);

    expect(deps.email.sent).toHaveLength(1);
    expect(deps.email.sent[0]).toEqual({
      to: "agent@example.test",
      subject: "New lead assigned to you",
      body: "You have a new lead assignment.",
    });
  });

  it("queue retry behavior: a failing message is marked failed, not acked, and stays retryable", async () => {
    const deps = makeDeps(new ThrowingResolver());
    deps.queue.enqueue("job-1", { event_type: "new_lead_assignment" });

    const result = await processAssignmentNotificationBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(deps.queue.acked).toHaveLength(0);
    expect(deps.queue.failed).toHaveLength(1);
    expect(deps.queue.failed[0]!.error).toContain("boom");
    // TestQueueAdapter simulates pgmq redelivery: the failed message goes
    // back on the queue for a later attempt.
    expect(deps.queue.queue).toHaveLength(1);
  });

  it("reports unexpected processor failures to the provided Sentry callback with only the job id, never payload content", async () => {
    const captured: Array<{ error: unknown; context: { jobId: string } }> = [];
    const deps = makeDeps(new ThrowingResolver());
    deps.queue.enqueue("job-1", {
      event_type: "new_lead_assignment",
      user_id: "sensitive-user-id",
    });

    await processAssignmentNotificationBatch({
      ...deps,
      captureException: (error, context) => {
        captured.push({ error, context });
      },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.context).toEqual({ jobId: "job-1" });
    expect(captured[0]!.error).toBeInstanceOf(Error);
  });

  it("continues processing the rest of the batch after one message fails", async () => {
    const deps = makeDeps(new ThrowingResolver());
    deps.queue.enqueue("job-1", { event_type: "new_lead_assignment" });
    deps.queue.enqueue("job-2", { event_type: "new_lead_assignment" });

    const result = await processAssignmentNotificationBatch(deps);

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(2);
    expect(deps.queue.failed).toHaveLength(2);
  });

  it("resolves zero recipients for an unrecognized event type without error", async () => {
    const deps = makeDeps();
    deps.queue.enqueue("job-1", { event_type: "unknown_event" });

    const result = await processAssignmentNotificationBatch(deps);

    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(deps.recorder.recorded).toHaveLength(0);
  });
});
