import { describe, expect, it } from "vitest";
import {
  isOrgAdmin,
  isTeamManager,
  isAgent,
  isActiveMembership,
  assertActiveMembership,
  assertOrgAdmin,
} from "@/lib/permissions/roles";
import { AppError } from "@/lib/errors/app-error";

describe("role predicates", () => {
  it("identifies each role correctly and exclusively", () => {
    expect(isOrgAdmin("org_admin")).toBe(true);
    expect(isOrgAdmin("agent")).toBe(false);
    expect(isTeamManager("team_manager")).toBe(true);
    expect(isTeamManager("org_admin")).toBe(false);
    expect(isAgent("agent")).toBe(true);
    expect(isAgent("team_manager")).toBe(false);
  });
});

describe("assertActiveMembership", () => {
  it("does not throw for an active membership", () => {
    expect(() => assertActiveMembership("active")).not.toThrow();
  });

  it.each(["invited", "inactive", "suspended"] as const)(
    "throws a forbidden AppError for status=%s",
    (status) => {
      expect(isActiveMembership(status)).toBe(false);
      try {
        assertActiveMembership(status);
        throw new Error("expected assertActiveMembership to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("forbidden");
      }
    },
  );
});

describe("assertOrgAdmin", () => {
  it("does not throw for org_admin", () => {
    expect(() => assertOrgAdmin("org_admin")).not.toThrow();
  });

  it.each(["team_manager", "agent"] as const)(
    "throws a forbidden AppError for role=%s",
    (role) => {
      try {
        assertOrgAdmin(role);
        throw new Error("expected assertOrgAdmin to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("forbidden");
      }
    },
  );
});
