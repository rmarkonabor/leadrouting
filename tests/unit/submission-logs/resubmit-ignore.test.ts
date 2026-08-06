import { describe, expect, it, vi, beforeEach } from "vitest";

const requireOrgAdminContextMock = vi.fn();

vi.mock("@/lib/permissions/require-context", () => ({
  requireOrgAdminContext: (...args: unknown[]) => requireOrgAdminContextMock(...args),
}));

vi.mock("@/lib/audit/log-audit-event", () => ({
  logAuditEvent: vi.fn(),
}));

describe("resubmitSubmissionLog / ignoreSubmissionLog", () => {
  beforeEach(() => {
    vi.resetModules();
    requireOrgAdminContextMock.mockReset();
    requireOrgAdminContextMock.mockResolvedValue({
      user: { id: "admin-1" },
      membership: { organizationId: "org-a", role: "org_admin", status: "active" },
    });
  });

  it("refuses to resubmit a log that already produced a lead", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () => ({
        from: (table: string) => {
          if (table === "submission_logs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: {
                          id: "log-1",
                          resulting_lead_id: "lead-1",
                          raw_payload: {},
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { resubmitSubmissionLog } =
      await import("@/modules/submission-logs/submission-logs");
    await expect(resubmitSubmissionLog("org-a", "log-1")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("creates a lead and marks the log resubmitted when the corrected payload is valid", async () => {
    const insertMock = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "new-lead" }, error: null }),
      }),
    }));
    const updateLogMock = vi.fn(() => ({
      eq: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: "log-1", status: "resubmitted" },
              error: null,
            }),
        }),
      }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () => ({
        from: (table: string) => {
          if (table === "submission_logs") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: {
                          id: "log-1",
                          resulting_lead_id: null,
                          raw_payload: { email: "a@example.com" },
                          lead_source_id: "source-1",
                          external_submission_id: null,
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
              update: updateLogMock,
            };
          }
          if (table === "field_mappings") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          source_field_name: "email",
                          destination_type: "default_field",
                          destination_field: "email",
                          data_type: "text",
                          required: true,
                          default_value: null,
                          transformation: null,
                          validation_rule: {},
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === "leads") {
            return { insert: insertMock };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { resubmitSubmissionLog } =
      await import("@/modules/submission-logs/submission-logs");
    const result = await resubmitSubmissionLog("org-a", "log-1");

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "resubmitted" });
  });

  it("ignores a submission log by setting its status to ignored", async () => {
    const updateMock = vi.fn(() => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: "log-1", status: "ignored" }, error: null }),
          }),
        }),
      }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () => ({
        from: (table: string) => {
          if (table === "submission_logs") {
            return { update: updateMock };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { ignoreSubmissionLog } =
      await import("@/modules/submission-logs/submission-logs");
    const result = await ignoreSubmissionLog("org-a", "log-1");

    expect(result).toMatchObject({ status: "ignored" });
  });
});
