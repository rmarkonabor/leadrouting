import { describe, expect, it, vi, beforeEach } from "vitest";

const requireOrgAdminContextMock = vi.fn();
const inviteUserMock = vi.fn();

vi.mock("@/lib/permissions/require-context", () => ({
  requireOrgAdminContext: (...args: unknown[]) => requireOrgAdminContextMock(...args),
}));

vi.mock("@/lib/audit/log-audit-event", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/modules/users/invite-user", () => ({
  inviteUser: (...args: unknown[]) => inviteUserMock(...args),
}));

describe("confirmImport", () => {
  beforeEach(() => {
    vi.resetModules();
    requireOrgAdminContextMock.mockReset();
    inviteUserMock.mockReset();
    requireOrgAdminContextMock.mockResolvedValue({
      user: { id: "admin-1" },
      membership: { organizationId: "org-a-id", role: "org_admin", status: "active" },
    });
  });

  /**
   * Audit requirement 7: invalid imports must not partially create records
   * unless the administrator explicitly chose partial processing. With
   * `allow_partial: false` and at least one invalid row, confirmImport must
   * create zero records — it must never even call inviteUser.
   */
  it("aborts with zero created records when the job disallows partial processing and has an invalid row", async () => {
    const job = { id: "job-1", status: "ready", allow_partial: false, summary: {} };
    const rows = [
      {
        id: "row-1",
        status: "valid",
        raw_data: { normalized: { email: "a@example.com", role: "agent", teamId: null } },
        errors: [],
      },
      {
        id: "row-2",
        status: "invalid",
        raw_data: { raw: {} },
        errors: ["Name is required."],
      },
    ];

    const updateJobMock = vi.fn(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () => ({
        from: (table: string) => {
          if (table === "import_jobs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: () => Promise.resolve({ data: job, error: null }),
                  }),
                }),
              }),
              update: updateJobMock,
            };
          }
          if (table === "import_rows") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: rows, error: null }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { confirmImport } = await import("@/modules/imports/import-users");
    const result = await confirmImport("org-a", "job-1");

    expect(result).toEqual({
      aborted: true,
      createdCount: 0,
      failedCount: 0,
      reason: "Import contains invalid rows and partial processing was not allowed.",
    });
    expect(inviteUserMock).not.toHaveBeenCalled();
    expect(updateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("creates only the valid rows when the job explicitly allows partial processing", async () => {
    const job = { id: "job-2", status: "ready", allow_partial: true, summary: {} };
    const rows = [
      {
        id: "row-1",
        status: "valid",
        raw_data: { normalized: { email: "a@example.com", role: "agent", teamId: null } },
        errors: [],
      },
      {
        id: "row-2",
        status: "invalid",
        raw_data: { raw: {} },
        errors: ["Name is required."],
      },
    ];

    inviteUserMock.mockResolvedValue({ id: "membership-1", user_id: "user-1" });
    const updateRowMock = vi.fn(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }));
    const updateJobMock = vi.fn(() => ({
      eq: () => Promise.resolve({ data: null, error: null }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () => ({
        from: (table: string) => {
          if (table === "import_jobs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: () => Promise.resolve({ data: job, error: null }),
                  }),
                }),
              }),
              update: updateJobMock,
            };
          }
          if (table === "import_rows") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: rows, error: null }),
                }),
              }),
              update: updateRowMock,
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { confirmImport } = await import("@/modules/imports/import-users");
    const result = await confirmImport("org-a", "job-2");

    expect(result.aborted).toBe(false);
    expect(result.createdCount).toBe(1);
    expect(inviteUserMock).toHaveBeenCalledTimes(1);
    expect(inviteUserMock).toHaveBeenCalledWith("org-a", {
      email: "a@example.com",
      role: "agent",
    });
  });
});
