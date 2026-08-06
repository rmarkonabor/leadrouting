import type { TerritoryType } from "@/lib/supabase/database.types";

const VALID_TERRITORY_TYPES: readonly TerritoryType[] = [
  "country",
  "state_province",
  "county",
  "city",
  "neighborhood",
  "postal_code",
  "radius",
];
const VALID_STATUSES = ["active", "inactive"] as const;

const TYPE_FIELD: Record<
  Exclude<TerritoryType, "radius">,
  keyof ParsedTerritoryImportRow
> = {
  country: "country",
  state_province: "stateProvince",
  county: "county",
  city: "city",
  neighborhood: "neighborhood",
  postal_code: "postalCode",
};

export interface ParsedTerritoryImportRow {
  name: string;
  territoryType: string;
  country: string;
  stateProvince: string;
  county: string;
  city: string;
  neighborhood: string;
  postalCode: string;
  centerLatitude: string;
  centerLongitude: string;
  radiusDistance: string;
  priority: string;
  status: string;
}

export interface ValidatedTerritoryImportRow {
  rowNumber: number;
  raw: ParsedTerritoryImportRow;
  status: "valid" | "invalid";
  errors: string[];
  normalized?: {
    name: string;
    territoryType: TerritoryType;
    country: string | null;
    stateProvince: string | null;
    county: string | null;
    city: string | null;
    neighborhood: string | null;
    postalCode: string | null;
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusDistance: number | null;
    priority: number;
    status: (typeof VALID_STATUSES)[number];
  };
}

export interface ValidateTerritoryImportRowsOptions {
  postgisAvailable: boolean;
}

/**
 * Pure validation of parsed territory-import CSV rows (spec §23 requirement
 * "Bulk import"). No I/O — this is what `confirmTerritoryImport`'s
 * abort-on-any-invalid-row-unless-allow_partial decision is based on,
 * mirroring Milestone 2's `validateUserImportRows`.
 */
export function validateTerritoryImportRows(
  rows: ParsedTerritoryImportRow[],
  options: ValidateTerritoryImportRowsOptions,
): ValidatedTerritoryImportRow[] {
  return rows.map((raw, index) => {
    const rowNumber = index + 1;
    const errors: string[] = [];

    const name = raw.name.trim();
    if (name.length === 0) {
      errors.push("Name is required.");
    }

    const territoryTypeRaw = raw.territoryType.trim().toLowerCase() as TerritoryType;
    if (!VALID_TERRITORY_TYPES.includes(territoryTypeRaw)) {
      errors.push(`territory_type must be one of: ${VALID_TERRITORY_TYPES.join(", ")}.`);
    }

    const country = raw.country.trim() || null;
    const stateProvince = raw.stateProvince.trim() || null;
    const county = raw.county.trim() || null;
    const city = raw.city.trim() || null;
    const neighborhood = raw.neighborhood.trim() || null;
    const postalCode = raw.postalCode.trim() || null;

    let centerLatitude: number | null = null;
    let centerLongitude: number | null = null;
    let radiusDistance: number | null = null;

    if (
      VALID_TERRITORY_TYPES.includes(territoryTypeRaw) &&
      territoryTypeRaw !== "radius"
    ) {
      const fieldKey = TYPE_FIELD[territoryTypeRaw];
      const fieldValue = {
        country,
        stateProvince,
        county,
        city,
        neighborhood,
        postalCode,
      }[
        fieldKey as
          "country" | "stateProvince" | "county" | "city" | "neighborhood" | "postalCode"
      ];
      if (!fieldValue) {
        errors.push(`${fieldKey} is required for territory_type "${territoryTypeRaw}".`);
      }
    } else if (territoryTypeRaw === "radius") {
      if (!options.postgisAvailable) {
        errors.push(
          "Radius territories are not available: PostGIS is not enabled on this database.",
        );
      }
      centerLatitude = parseCoordinate(
        raw.centerLatitude,
        "center_latitude",
        -90,
        90,
        errors,
      );
      centerLongitude = parseCoordinate(
        raw.centerLongitude,
        "center_longitude",
        -180,
        180,
        errors,
      );
      const radiusRaw = raw.radiusDistance.trim();
      if (radiusRaw.length === 0) {
        errors.push('radius_distance is required for territory_type "radius".');
      } else {
        const value = Number(radiusRaw);
        if (!Number.isFinite(value) || value <= 0) {
          errors.push("radius_distance must be a positive number.");
        } else {
          radiusDistance = value;
        }
      }
    }

    const priorityRaw = raw.priority.trim();
    let priority = 100;
    if (priorityRaw.length > 0) {
      const value = Number(priorityRaw);
      if (!Number.isInteger(value) || value < 1) {
        errors.push("priority must be a whole number of 1 or more.");
      } else {
        priority = value;
      }
    }

    const statusRaw = (raw.status.trim().toLowerCase() ||
      "active") as (typeof VALID_STATUSES)[number];
    if (!VALID_STATUSES.includes(statusRaw)) {
      errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}.`);
    }

    const rowStatus: "valid" | "invalid" = errors.length === 0 ? "valid" : "invalid";

    return {
      rowNumber,
      raw,
      status: rowStatus,
      errors,
      ...(rowStatus === "valid"
        ? {
            normalized: {
              name,
              territoryType: territoryTypeRaw,
              country,
              stateProvince,
              county,
              city,
              neighborhood,
              postalCode,
              centerLatitude,
              centerLongitude,
              radiusDistance,
              priority,
              status: statusRaw,
            },
          }
        : {}),
    };
  });
}

function parseCoordinate(
  raw: string,
  label: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push(`${label} is required for territory_type "radius".`);
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push(`${label} must be a number between ${min} and ${max}.`);
    return null;
  }
  return value;
}

/** Generates a downloadable CSV of only the invalid rows and their errors. */
export function generateTerritoryErrorCsv(
  validatedRows: ValidatedTerritoryImportRow[],
): string {
  const invalidRows = validatedRows.filter((r) => r.status === "invalid");
  const header = "row_number,name,territory_type,errors\n";
  const lines = invalidRows.map((r) =>
    [String(r.rowNumber), r.raw.name, r.raw.territoryType, r.errors.join("; ")]
      .map(csvEscape)
      .join(","),
  );
  return header + lines.join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
