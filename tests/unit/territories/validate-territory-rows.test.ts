import { describe, expect, it } from "vitest";
import {
  validateTerritoryImportRows,
  type ParsedTerritoryImportRow,
} from "@/modules/territories/validate-territory-rows";

function row(overrides: Partial<ParsedTerritoryImportRow>): ParsedTerritoryImportRow {
  return {
    name: "Test Territory",
    territoryType: "postal_code",
    country: "",
    stateProvince: "",
    county: "",
    city: "",
    neighborhood: "",
    postalCode: "M5V 1J2",
    centerLatitude: "",
    centerLongitude: "",
    radiusDistance: "",
    priority: "",
    status: "",
    ...overrides,
  };
}

describe("validateTerritoryImportRows", () => {
  it("accepts a valid postal_code row", () => {
    const [result] = validateTerritoryImportRows([row({})], { postgisAvailable: false });
    expect(result?.status).toBe("valid");
    expect(result?.normalized?.postalCode).toBe("M5V 1J2");
    expect(result?.normalized?.priority).toBe(100);
  });

  it("rejects an unknown territory_type", () => {
    const [result] = validateTerritoryImportRows([row({ territoryType: "planet" })], {
      postgisAvailable: false,
    });
    expect(result?.status).toBe("invalid");
    expect(result?.errors.join(" ")).toMatch(/territory_type must be one of/);
  });

  it("rejects a row missing the field required by its territory_type", () => {
    const [result] = validateTerritoryImportRows(
      [row({ territoryType: "city", postalCode: "", city: "" })],
      { postgisAvailable: false },
    );
    expect(result?.status).toBe("invalid");
    expect(result?.errors.join(" ")).toMatch(/city is required/);
  });

  it("rejects a radius row when PostGIS is unavailable", () => {
    const [result] = validateTerritoryImportRows(
      [
        row({
          territoryType: "radius",
          postalCode: "",
          centerLatitude: "43.65",
          centerLongitude: "-79.38",
          radiusDistance: "5000",
        }),
      ],
      { postgisAvailable: false },
    );
    expect(result?.status).toBe("invalid");
    expect(result?.errors.join(" ")).toMatch(/PostGIS is not enabled/);
  });

  it("accepts a valid radius row when PostGIS is available", () => {
    const [result] = validateTerritoryImportRows(
      [
        row({
          territoryType: "radius",
          postalCode: "",
          centerLatitude: "43.65",
          centerLongitude: "-79.38",
          radiusDistance: "5000",
        }),
      ],
      { postgisAvailable: true },
    );
    expect(result?.status).toBe("valid");
    expect(result?.normalized?.radiusDistance).toBe(5000);
  });

  it("rejects an out-of-range latitude for a radius row", () => {
    const [result] = validateTerritoryImportRows(
      [
        row({
          territoryType: "radius",
          postalCode: "",
          centerLatitude: "200",
          centerLongitude: "-79.38",
          radiusDistance: "5000",
        }),
      ],
      { postgisAvailable: true },
    );
    expect(result?.status).toBe("invalid");
  });

  it("rejects an invalid location with no identifying fields at all", () => {
    const [result] = validateTerritoryImportRows(
      [row({ territoryType: "country", postalCode: "", country: "" })],
      { postgisAvailable: false },
    );
    expect(result?.status).toBe("invalid");
  });
});
