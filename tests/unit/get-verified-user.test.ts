import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

describe("getVerifiedUser", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    vi.resetModules();
  });

  it("returns the user when supabase.auth.getUser() succeeds", async () => {
    const fakeUser = { id: "user-1", email: "person@example.com" };
    getUserMock.mockResolvedValue({ data: { user: fakeUser }, error: null });

    const { getVerifiedUser } = await import("@/lib/supabase/get-verified-user");
    const result = await getVerifiedUser();

    expect(result).toEqual(fakeUser);
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when supabase.auth.getUser() returns an error", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    const { getVerifiedUser } = await import("@/lib/supabase/get-verified-user");
    const result = await getVerifiedUser();

    expect(result).toBeNull();
  });

  it("returns null when there is no user even without an explicit error", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const { getVerifiedUser } = await import("@/lib/supabase/get-verified-user");
    const result = await getVerifiedUser();

    expect(result).toBeNull();
  });

  it("never calls getSession() as a substitute for getUser()", async () => {
    const getSessionMock = vi.fn();
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const { getVerifiedUser } = await import("@/lib/supabase/get-verified-user");
    await getVerifiedUser();

    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
