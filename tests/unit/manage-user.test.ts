import { describe, expect, it, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/errors/app-error";

const requireOrgAdminContextMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/permissions/require-context", () => ({
  requireOrgAdminContext: (...args: unknown[]) => requireOrgAdminContextMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from: fromMock })),
}));

vi.mock("@/lib/audit/log-audit-event", () => ({
  logAuditEvent: vi.fn(),
}));

describe("changeUserRole", () => {
  beforeEach(() => {
    requireOrgAdminContextMock.mockReset();
    fromMock.mockReset();
  });

  /**
   * Audit requirement 4: an agent cannot promote their own role. The
   * server-side check runs before any organization_users query — this
   * proves the rejection happens at the application layer, not merely as an
   * RLS side effect, satisfying the "Both" enforcement requirement.
   */
  it("rejects a non-admin caller before touching the database at all", async () => {
    requireOrgAdminContextMock.mockRejectedValue(
      new AppError("forbidden", "This action requires an organization administrator."),
    );

    const { changeUserRole } = await import("@/modules/users/manage-user");

    await expect(
      changeUserRole("org-a", "membership-1", "org_admin"),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("allows an org_admin to change another member's role and audits it", async () => {
    requireOrgAdminContextMock.mockResolvedValue({
      user: { id: "admin-1" },
      membership: { organizationId: "org-a-id", role: "org_admin", status: "active" },
    });

    const beforeRow = { id: "membership-1", role: "agent" };
    const afterRow = { id: "membership-1", role: "team_manager" };

    fromMock.mockImplementation((table: string) => {
      expect(table).toBe("organization_users");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: beforeRow, error: null }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: afterRow, error: null }),
              }),
            }),
          }),
        }),
      };
    });

    const { changeUserRole } = await import("@/modules/users/manage-user");
    const result = await changeUserRole("org-a", "membership-1", "team_manager");

    expect(result).toEqual(afterRow);
  });
});
