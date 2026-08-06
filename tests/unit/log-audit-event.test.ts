import { describe, expect, it, vi } from "vitest";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

describe("logAuditEvent", () => {
  it("inserts an audit_logs row with the actor and organization scoped correctly", async () => {
    const insertMock = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: vi.fn(() => ({ insert: insertMock })) } as never;

    await logAuditEvent(supabase, {
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "team_created",
      entityType: "team",
      entityId: "team-1",
      afterData: { name: "Sales" },
    });

    expect(insertMock).toHaveBeenCalledWith({
      organization_id: "org-1",
      actor_user_id: "user-1",
      action: "team_created",
      entity_type: "team",
      entity_id: "team-1",
      before_data: null,
      after_data: { name: "Sales" },
    });
  });

  it("does not throw when the insert fails (never blocks the audited action)", async () => {
    const insertMock = vi.fn(() =>
      Promise.resolve({ error: { code: "42501", message: "denied" } }),
    );
    const supabase = { from: vi.fn(() => ({ insert: insertMock })) } as never;

    await expect(
      logAuditEvent(supabase, {
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "team_created",
        entityType: "team",
      }),
    ).resolves.toBeUndefined();
  });
});
