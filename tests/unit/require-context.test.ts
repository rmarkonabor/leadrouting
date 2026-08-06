import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();

vi.mock("@/lib/supabase/get-verified-user", () => ({
  getVerifiedUser: () => getUserMock(),
}));

function makeSupabaseMock(options: {
  memberships: Array<{ organization_id: string; role: string; status: string }>;
  organizations: Array<{ id: string; name: string; slug: string }>;
}) {
  return {
    from(table: string) {
      if (table === "organization_users") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: options.memberships, error: null }),
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: options.organizations, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("requireMembershipContext / requireOrgAdminContext", () => {
  beforeEach(() => {
    vi.resetModules();
    getUserMock.mockReset();
  });

  /**
   * Audit requirement 5: a browser-supplied organization slug/id must never
   * change the tenant context. The caller here is only an active member of
   * "org-a" — requesting "org-b" (a real organization, just not one they
   * belong to) must be rejected, not silently redirected to org-a or
   * granted org-b access.
   */
  it("rejects a request for an organization the caller is not an active member of", async () => {
    const orgAId = "11111111-1111-4111-8111-111111111111";
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () =>
        makeSupabaseMock({
          memberships: [{ organization_id: orgAId, role: "org_admin", status: "active" }],
          organizations: [{ id: orgAId, name: "Org A", slug: "org-a" }],
        }),
      ),
    }));

    const { requireMembershipContext } =
      await import("@/lib/permissions/require-context");

    // Not using `.toThrow(AppError)` here: `vi.resetModules()` in
    // `beforeEach` gives the dynamically re-imported module its own copy of
    // the AppError class, so `instanceof` against the statically-imported
    // AppError above would fail even though the thrown error is a real
    // AppError from the module under test.
    await expect(requireMembershipContext("org-b")).rejects.toMatchObject({
      code: "organization_not_found_or_forbidden",
    });
  });

  it("resolves the caller's real membership when no slug hint is given", async () => {
    const orgAId = "11111111-1111-4111-8111-111111111111";
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () =>
        makeSupabaseMock({
          memberships: [{ organization_id: orgAId, role: "org_admin", status: "active" }],
          organizations: [{ id: orgAId, name: "Org A", slug: "org-a" }],
        }),
      ),
    }));

    const { requireMembershipContext } =
      await import("@/lib/permissions/require-context");
    const { membership } = await requireMembershipContext();
    expect(membership.organizationId).toBe(orgAId);
  });

  /**
   * Audit requirement 6: a deactivated (inactive/suspended) membership must
   * not grant access, even to their own organization.
   */
  it.each(["invited", "inactive", "suspended"] as const)(
    "rejects a %s membership even for the caller's own organization",
    async (status) => {
      const orgAId = "11111111-1111-4111-8111-111111111111";
      getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

      vi.doMock("@/lib/supabase/server", () => ({
        createServerSupabaseClient: vi.fn(async () =>
          makeSupabaseMock({
            memberships: [{ organization_id: orgAId, role: "agent", status }],
            organizations: [{ id: orgAId, name: "Org A", slug: "org-a" }],
          }),
        ),
      }));

      const { requireMembershipContext } =
        await import("@/lib/permissions/require-context");
      await expect(requireMembershipContext("org-a")).rejects.toMatchObject({
        code: "no_organization_membership",
      });
    },
  );

  it("requireOrgAdminContext rejects a non-admin caller before any admin-only work runs", async () => {
    const orgAId = "11111111-1111-4111-8111-111111111111";
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    vi.doMock("@/lib/supabase/server", () => ({
      createServerSupabaseClient: vi.fn(async () =>
        makeSupabaseMock({
          memberships: [{ organization_id: orgAId, role: "agent", status: "active" }],
          organizations: [{ id: orgAId, name: "Org A", slug: "org-a" }],
        }),
      ),
    }));

    const { requireOrgAdminContext } = await import("@/lib/permissions/require-context");
    await expect(requireOrgAdminContext("org-a")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
