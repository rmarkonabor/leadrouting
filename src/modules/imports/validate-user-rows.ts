import type { OrganizationRole } from "@/lib/supabase/database.types";

const VALID_ROLES: readonly OrganizationRole[] = ["org_admin", "team_manager", "agent"];
const VALID_AVAILABILITY_STATUSES = [
  "available",
  "busy",
  "away",
  "vacation",
  "offline",
] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedUserImportRow {
  name: string;
  email: string;
  role: string;
  team: string;
  availability: string;
  timezone: string;
  dailyLeadLimit: string;
  activeLeadLimit: string;
  assignmentWeight: string;
}

export interface ValidatedUserImportRow {
  rowNumber: number;
  raw: ParsedUserImportRow;
  status: "valid" | "invalid";
  errors: string[];
  normalized?: {
    name: string;
    email: string;
    role: OrganizationRole;
    teamId: string | null;
    availabilityStatus: (typeof VALID_AVAILABILITY_STATUSES)[number];
    timezone: string;
    dailyLeadLimit: number | null;
    activeLeadLimit: number | null;
    assignmentWeight: number | null;
  };
}

export interface ValidateUserImportRowsOptions {
  /** Lowercased team name -> team id, for the organization the import targets. */
  teamIdsByLowercaseName: Map<string, string>;
  /** Lowercased emails already an active or invited member of this organization. */
  existingMemberEmails: Set<string>;
}

/**
 * Pure validation of parsed CSV rows against spec §14's bulk-import column
 * list (name/email/role/team/availability/timezone/capacity/weight —
 * recipient attributes and territory information are accepted columns but
 * not yet applied by this validator; territories don't exist until
 * Milestone 4). No I/O — fully unit-testable, and this is what
 * `confirmImport`'s "abort on any invalid row unless allow_partial" decision
 * is based on, so the zero-partial-create guarantee can be tested without a
 * database.
 */
export function validateUserImportRows(
  rows: ParsedUserImportRow[],
  options: ValidateUserImportRowsOptions,
): ValidatedUserImportRow[] {
  const seenEmailsInFile = new Set<string>();

  return rows.map((raw, index) => {
    const rowNumber = index + 1;
    const errors: string[] = [];

    const name = raw.name.trim();
    if (name.length === 0) {
      errors.push("Name is required.");
    }

    const email = raw.email.trim().toLowerCase();
    if (email.length === 0) {
      errors.push("Email is required.");
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.push("Email is not a valid email address.");
    } else if (seenEmailsInFile.has(email)) {
      errors.push("Duplicate email within this file.");
    } else if (options.existingMemberEmails.has(email)) {
      errors.push("This email is already a member of the organization.");
    }
    seenEmailsInFile.add(email);

    const roleRaw = raw.role.trim().toLowerCase();
    const role: OrganizationRole = (roleRaw || "agent") as OrganizationRole;
    if (!VALID_ROLES.includes(role)) {
      errors.push(`Role must be one of: ${VALID_ROLES.join(", ")}.`);
    }

    let teamId: string | null = null;
    const teamRaw = raw.team.trim();
    if (teamRaw.length > 0) {
      const match = options.teamIdsByLowercaseName.get(teamRaw.toLowerCase());
      if (!match) {
        errors.push(`Team "${teamRaw}" does not exist in this organization.`);
      } else {
        teamId = match;
      }
    }

    const availabilityRaw = (raw.availability.trim().toLowerCase() ||
      "available") as (typeof VALID_AVAILABILITY_STATUSES)[number];
    if (!VALID_AVAILABILITY_STATUSES.includes(availabilityRaw)) {
      errors.push(
        `Availability must be one of: ${VALID_AVAILABILITY_STATUSES.join(", ")}.`,
      );
    }

    const timezone = raw.timezone.trim() || "UTC";

    const dailyLeadLimit = parseOptionalNonNegativeInt(
      raw.dailyLeadLimit,
      "Daily lead capacity",
      errors,
    );
    const activeLeadLimit = parseOptionalNonNegativeInt(
      raw.activeLeadLimit,
      "Active lead capacity",
      errors,
    );
    const assignmentWeight = parseOptionalPositiveInt(
      raw.assignmentWeight,
      "Assignment weight",
      errors,
    );

    const status: "valid" | "invalid" = errors.length === 0 ? "valid" : "invalid";

    return {
      rowNumber,
      raw,
      status,
      errors,
      ...(status === "valid"
        ? {
            normalized: {
              name,
              email,
              role,
              teamId,
              availabilityStatus: availabilityRaw,
              timezone,
              dailyLeadLimit,
              activeLeadLimit,
              assignmentWeight,
            },
          }
        : {}),
    };
  });
}

function parseOptionalNonNegativeInt(
  raw: string,
  label: string,
  errors: string[],
): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a whole number of 0 or more.`);
    return null;
  }
  return value;
}

function parseOptionalPositiveInt(
  raw: string,
  label: string,
  errors: string[],
): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label} must be a whole number greater than 0.`);
    return null;
  }
  return value;
}

/** Generates a downloadable CSV of only the invalid rows and their errors (spec §14 "downloadable error file"). */
export function generateErrorCsv(validatedRows: ValidatedUserImportRow[]): string {
  const invalidRows = validatedRows.filter((r) => r.status === "invalid");
  const header = "row_number,name,email,role,team,errors\n";
  const lines = invalidRows.map((r) => {
    const cells = [
      String(r.rowNumber),
      r.raw.name,
      r.raw.email,
      r.raw.role,
      r.raw.team,
      r.errors.join("; "),
    ];
    return cells.map(csvEscape).join(",");
  });
  return header + lines.join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
