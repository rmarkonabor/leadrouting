import { describe, expect, it } from "vitest";
import {
  validateUserImportRows,
  generateErrorCsv,
  type ParsedUserImportRow,
} from "@/modules/imports/validate-user-rows";

function row(overrides: Partial<ParsedUserImportRow> = {}): ParsedUserImportRow {
  return {
    name: "Jane Doe",
    email: "jane@example.com",
    role: "agent",
    team: "",
    availability: "",
    timezone: "",
    dailyLeadLimit: "",
    activeLeadLimit: "",
    assignmentWeight: "",
    ...overrides,
  };
}

describe("validateUserImportRows", () => {
  it("marks a well-formed row valid and normalizes defaults", () => {
    const [result] = validateUserImportRows([row()], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });

    expect(result?.status).toBe("valid");
    expect(result?.errors).toEqual([]);
    expect(result?.normalized).toMatchObject({
      email: "jane@example.com",
      role: "agent",
      availabilityStatus: "available",
      timezone: "UTC",
      teamId: null,
    });
  });

  it("rejects a missing name", () => {
    const [result] = validateUserImportRows([row({ name: "" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors).toContain("Name is required.");
  });

  it("rejects an invalid email format", () => {
    const [result] = validateUserImportRows([row({ email: "not-an-email" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors.some((e) => /valid email/.test(e))).toBe(true);
  });

  it("rejects a duplicate email within the same file", () => {
    const rows = [row({ email: "dup@example.com" }), row({ email: "dup@example.com" })];
    const results = validateUserImportRows(rows, {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(results[0]?.status).toBe("valid");
    expect(results[1]?.status).toBe("invalid");
    expect(results[1]?.errors).toContain("Duplicate email within this file.");
  });

  it("rejects an email that already belongs to a member of the organization", () => {
    const [result] = validateUserImportRows([row({ email: "existing@example.com" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(["existing@example.com"]),
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors.some((e) => /already a member/.test(e))).toBe(true);
  });

  it("rejects an unrecognized role", () => {
    const [result] = validateUserImportRows([row({ role: "superuser" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors.some((e) => /Role must be one of/.test(e))).toBe(true);
  });

  it("resolves a team name to its id, case-insensitively", () => {
    const [result] = validateUserImportRows([row({ team: "Sales" })], {
      teamIdsByLowercaseName: new Map([["sales", "team-123"]]),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("valid");
    expect(result?.normalized?.teamId).toBe("team-123");
  });

  it("rejects a team name that does not exist in the organization", () => {
    const [result] = validateUserImportRows([row({ team: "Ghost Team" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors.some((e) => /does not exist/.test(e))).toBe(true);
  });

  it.each(["-1", "abc", "1.5"])(
    "rejects an invalid daily lead capacity value %s",
    (value) => {
      const [result] = validateUserImportRows([row({ dailyLeadLimit: value })], {
        teamIdsByLowercaseName: new Map(),
        existingMemberEmails: new Set(),
      });
      expect(result?.status).toBe("invalid");
    },
  );

  it("rejects a zero or negative assignment weight", () => {
    const [result] = validateUserImportRows([row({ assignmentWeight: "0" })], {
      teamIdsByLowercaseName: new Map(),
      existingMemberEmails: new Set(),
    });
    expect(result?.status).toBe("invalid");
  });
});

describe("generateErrorCsv", () => {
  it("includes only invalid rows with their errors, and escapes commas", () => {
    const results = validateUserImportRows(
      [row({ name: "" }), row({ email: "second@example.com" })],
      { teamIdsByLowercaseName: new Map(), existingMemberEmails: new Set() },
    );

    const csv = generateErrorCsv(results);
    expect(csv).toContain("row_number,name,email,role,team,errors");
    expect(csv).toContain("Name is required.");
    expect(csv).not.toContain("second@example.com");
  });
});
