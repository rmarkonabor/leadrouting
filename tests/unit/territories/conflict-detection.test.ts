import { describe, expect, it } from "vitest";
import {
  detectOverlappingTerritories,
  detectTerritoriesWithoutActiveRecipients,
  detectEqualPriorityConflicts,
  detectUncoveredLocations,
  type TerritoryRecipientInfo,
} from "@/modules/territories/conflict-detection";
import type { TerritoryCandidate } from "@/modules/territories/match-territories";

function territory(overrides: Partial<TerritoryCandidate>): TerritoryCandidate {
  return {
    id: "t-1",
    territoryType: "country",
    country: null,
    stateProvince: null,
    county: null,
    city: null,
    neighborhood: null,
    postalCode: null,
    centerLatitude: null,
    centerLongitude: null,
    radiusDistanceMeters: null,
    priority: 100,
    status: "active",
    ...overrides,
  };
}

describe("detectOverlappingTerritories", () => {
  it("flags two active territories that would match the exact same location", () => {
    const a = territory({ id: "a", territoryType: "postal_code", postalCode: "M5V 1J2" });
    const b = territory({ id: "b", territoryType: "postal_code", postalCode: "m5v 1j2" });
    const warnings = detectOverlappingTerritories([a, b]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: "warning",
      code: "territories_overlap",
    });
    expect(warnings[0]?.territoryIds.sort()).toEqual(["a", "b"]);
  });

  it("does not flag two active territories of different types even with similar names", () => {
    const a = territory({
      id: "a",
      territoryType: "city",
      city: "Toronto",
      country: "Canada",
    });
    const b = territory({ id: "b", territoryType: "postal_code", postalCode: "M5V 1J2" });
    expect(detectOverlappingTerritories([a, b])).toEqual([]);
  });

  it("does not flag an inactive territory that would otherwise overlap", () => {
    const a = territory({ id: "a", territoryType: "postal_code", postalCode: "M5V 1J2" });
    const b = territory({
      id: "b",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      status: "inactive",
    });
    expect(detectOverlappingTerritories([a, b])).toEqual([]);
  });

  it("flags two overlapping radius territories by distance", () => {
    const a = territory({
      id: "a",
      territoryType: "radius",
      centerLatitude: 43.65,
      centerLongitude: -79.38,
      radiusDistanceMeters: 20_000,
    });
    const b = territory({
      id: "b",
      territoryType: "radius",
      centerLatitude: 43.66,
      centerLongitude: -79.38,
      radiusDistanceMeters: 20_000,
    });
    const warnings = detectOverlappingTerritories([a, b]);
    expect(warnings).toHaveLength(1);
  });
});

describe("detectTerritoriesWithoutActiveRecipients", () => {
  it("flags a territory with no linked users or teams at all", () => {
    const t = territory({ id: "t" });
    const info = new Map<string, TerritoryRecipientInfo>();
    const warnings = detectTerritoriesWithoutActiveRecipients([t], info);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "territory_no_active_recipients",
      territoryIds: ["t"],
    });
  });

  it("does not flag a territory with an active direct user", () => {
    const t = territory({ id: "t" });
    const info = new Map<string, TerritoryRecipientInfo>([
      [
        "t",
        { territoryId: "t", hasActiveDirectUser: true, hasTeamWithActiveMember: false },
      ],
    ]);
    expect(detectTerritoriesWithoutActiveRecipients([t], info)).toEqual([]);
  });

  it("does not flag an inactive territory even with no recipients", () => {
    const t = territory({ id: "t", status: "inactive" });
    const info = new Map<string, TerritoryRecipientInfo>();
    expect(detectTerritoriesWithoutActiveRecipients([t], info)).toEqual([]);
  });
});

describe("detectEqualPriorityConflicts", () => {
  it("flags two active territories matching the same location with equal priority", () => {
    const a = territory({
      id: "a",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 5,
    });
    const b = territory({
      id: "b",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 5,
    });
    const warnings = detectEqualPriorityConflicts([a, b]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: "blocking_error",
      code: "equal_priority_conflict",
    });
  });

  it("does not flag territories matching the same location with different priorities", () => {
    const a = territory({
      id: "a",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 1,
    });
    const b = territory({
      id: "b",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 2,
    });
    expect(detectEqualPriorityConflicts([a, b])).toEqual([]);
  });

  it("does not flag inactive territories", () => {
    const a = territory({
      id: "a",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 5,
      status: "inactive",
    });
    const b = territory({
      id: "b",
      territoryType: "postal_code",
      postalCode: "M5V 1J2",
      priority: 5,
      status: "inactive",
    });
    expect(detectEqualPriorityConflicts([a, b])).toEqual([]);
  });
});

describe("detectUncoveredLocations", () => {
  it("flags an observed lead location that matches no active territory", () => {
    const t = territory({ id: "t", territoryType: "postal_code", postalCode: "K1A 0A6" });
    const warnings = detectUncoveredLocations(
      [{ postalCode: "M5V 1J2", leadCount: 3 }],
      [t],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: "information",
      code: "uncovered_area",
    });
  });

  it("does not flag a location that matches an active territory", () => {
    const t = territory({ id: "t", territoryType: "postal_code", postalCode: "M5V 1J2" });
    expect(
      detectUncoveredLocations([{ postalCode: "M5V 1J2", leadCount: 1 }], [t]),
    ).toEqual([]);
  });
});
