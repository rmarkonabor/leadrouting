import { describe, expect, it } from "vitest";
import {
  matchTerritories,
  bestMatchingTerritory,
  haversineDistanceMeters,
  type TerritoryCandidate,
} from "@/modules/territories/match-territories";

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

describe("matchTerritories — every supported territory type", () => {
  it("matches a country territory", () => {
    const t = territory({ territoryType: "country", country: "Canada" });
    expect(matchTerritories({ country: "canada" }, [t])).toEqual([t]);
  });

  it("matches a state_province territory (scoped by country)", () => {
    const t = territory({
      territoryType: "state_province",
      stateProvince: "Ontario",
      country: "Canada",
    });
    expect(
      matchTerritories({ stateProvince: "Ontario", country: "Canada" }, [t]),
    ).toEqual([t]);
    expect(matchTerritories({ stateProvince: "Ontario", country: "USA" }, [t])).toEqual(
      [],
    );
  });

  it("matches a county territory", () => {
    const t = territory({
      territoryType: "county",
      county: "King County",
      stateProvince: "Washington",
      country: "USA",
    });
    expect(
      matchTerritories(
        { county: "King County", stateProvince: "Washington", country: "USA" },
        [t],
      ),
    ).toEqual([t]);
  });

  it("matches a city territory", () => {
    const t = territory({
      territoryType: "city",
      city: "Toronto",
      stateProvince: "Ontario",
      country: "Canada",
    });
    expect(
      matchTerritories({ city: "Toronto", stateProvince: "Ontario", country: "Canada" }, [
        t,
      ]),
    ).toEqual([t]);
  });

  it("matches a neighborhood territory", () => {
    const t = territory({
      territoryType: "neighborhood",
      neighborhood: "Downtown",
      city: "Toronto",
      country: "Canada",
    });
    expect(
      matchTerritories({ neighborhood: "Downtown", city: "Toronto", country: "Canada" }, [
        t,
      ]),
    ).toEqual([t]);
  });

  it("matches a postal_code territory", () => {
    const t = territory({ territoryType: "postal_code", postalCode: "M5V 1J2" });
    expect(matchTerritories({ postalCode: "m5v 1j2" }, [t])).toEqual([t]);
  });

  it("matches a radius territory using haversine distance", () => {
    const t = territory({
      territoryType: "radius",
      centerLatitude: 43.6532,
      centerLongitude: -79.3832,
      radiusDistanceMeters: 10_000,
    });
    // A point ~2km away should match; ~50km away should not.
    expect(matchTerritories({ latitude: 43.66, longitude: -79.39 }, [t])).toEqual([t]);
    expect(matchTerritories({ latitude: 44.1, longitude: -79.3832 }, [t])).toEqual([]);
  });

  it("excludes inactive territories even when the location would otherwise match", () => {
    const t = territory({
      territoryType: "country",
      country: "Canada",
      status: "inactive",
    });
    expect(matchTerritories({ country: "Canada" }, [t])).toEqual([]);
  });

  it("returns no matches for an invalid/unrecognized location", () => {
    const t = territory({ territoryType: "postal_code", postalCode: "M5V 1J2" });
    expect(matchTerritories({}, [t])).toEqual([]);
  });

  it("sorts matches by priority ascending (lower number wins) via bestMatchingTerritory", () => {
    const low = territory({
      id: "low",
      territoryType: "country",
      country: "Canada",
      priority: 50,
    });
    const high = territory({
      id: "high",
      territoryType: "country",
      country: "Canada",
      priority: 1,
    });
    expect(bestMatchingTerritory({ country: "Canada" }, [low, high])?.id).toBe("high");
  });
});

describe("haversineDistanceMeters", () => {
  it("returns ~0 for identical coordinates", () => {
    expect(haversineDistanceMeters(43.65, -79.38, 43.65, -79.38)).toBeCloseTo(0, 3);
  });

  it("returns a larger distance for farther-apart coordinates", () => {
    const near = haversineDistanceMeters(43.65, -79.38, 43.66, -79.38);
    const far = haversineDistanceMeters(43.65, -79.38, 45.0, -79.38);
    expect(far).toBeGreaterThan(near);
  });
});
