import { describe, expect, it, vi, beforeEach } from "vitest";

const requireOrgAdminContextMock = vi.fn();

vi.mock("@/lib/permissions/require-context", () => ({
  requireOrgAdminContext: (...args: unknown[]) => requireOrgAdminContextMock(...args),
}));

vi.mock("@/lib/audit/log-audit-event", () => ({
  logAuditEvent: vi.fn(),
}));

describe("confirmTerritoryImport", () => {
  beforeEach(() => {
    vi.resetModules();
    requireOrgAdminContextMock.mockReset();
    requireOrgAdminContextMock.mockResolvedValue({
      user: { id: "admin-1" },
      membership: { organizationId: "org-a-id", role: "org_admin", status: "active" },
    });
  });

  /**
   * Required test: bulk import rollback. With allow_partial: false and at
   * least one invalid row, confirmTerritoryImport must create zero
   * territory records — it must never even attempt the batch insert.
   */
  it("aborts with zero created territories when the job disallows partial processing and has an invalid row", async () => {
    const job = { id: "job-1", status: "ready", allow_partial: false, summary: {} };
    const rows = [
      {
        id: "row-1",
        status: "valid",
        raw_data: {
          normalized: {
            name: "Downtown",
            territoryType: "postal_code",
            country: null,
            stateProvince: null,
            county: null,
            city: null,
            neighborhood: null,
            postalCode: "M5V 1J2",
            centerLatitude: null,
            centerLongitude: null,
            radiusDistance: null,
            priority: 100,
            status: "active",
          },
        },
        errors: [],
      },
      {
        id: "row-2",
        status: "invalid",
        raw_data: { raw: {} },
        errors: ["territory_type must be one of: ..."],
      },
    ];

    const insertMock = vi.fn();
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
          if (table === "territories") {
            return { insert: insertMock };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { confirmTerritoryImport } =
      await import("@/modules/territories/import-territories");
    const result = await confirmTerritoryImport("org-a", "job-1");

    expect(result).toEqual({
      aborted: true,
      createdCount: 0,
      failedCount: 0,
      reason: "Import contains invalid rows and partial processing was not allowed.",
    });
    expect(insertMock).not.toHaveBeenCalled();
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
        raw_data: {
          normalized: {
            name: "Downtown",
            territoryType: "postal_code",
            country: null,
            stateProvince: null,
            county: null,
            city: null,
            neighborhood: null,
            postalCode: "M5V 1J2",
            centerLatitude: null,
            centerLongitude: null,
            radiusDistance: null,
            priority: 100,
            status: "active",
          },
        },
        errors: [],
      },
      {
        id: "row-2",
        status: "invalid",
        raw_data: { raw: {} },
        errors: ["bad row"],
      },
    ];

    const insertMock = vi.fn(() => ({
      select: () => Promise.resolve({ data: [{ id: "new-territory" }], error: null }),
    }));
    const updateRowMock = vi.fn(() => ({
      in: () => Promise.resolve({ data: null, error: null }),
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
          if (table === "territories") {
            return { insert: insertMock };
          }
          throw new Error(`unexpected table ${table}`);
        },
      })),
    }));

    const { confirmTerritoryImport } =
      await import("@/modules/territories/import-territories");
    const result = await confirmTerritoryImport("org-a", "job-2");

    expect(result.aborted).toBe(false);
    expect(result.createdCount).toBe(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
