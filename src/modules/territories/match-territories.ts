import type { TerritoryStatus, TerritoryType } from "@/lib/supabase/database.types";

export interface TerritoryCandidate {
  id: string;
  territoryType: TerritoryType;
  country: string | null;
  stateProvince: string | null;
  county: string | null;
  city: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusDistanceMeters: number | null;
  priority: number;
  status: TerritoryStatus;
}

export interface LeadLocationForMatching {
  country?: string | null;
  stateProvince?: string | null;
  county?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

function normalizeForCompare(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function equalsIgnoreCase(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  return na !== null && na === nb;
}

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance via the haversine formula. Used for the pure-JS,
 * unit-testable radius-matching path, decoupled from a live PostGIS
 * `ST_DWithin` query — see docs/decisions.md. Matches PostGIS's `geography`
 * distance calculation closely enough for territory-radius purposes (both
 * are spherical-earth approximations); an exact match against a live
 * database isn't required since this function never runs against real rows
 * on its own — `modules/territories/territories.ts` uses PostGIS
 * `ST_DWithin` for the actual database-backed radius query, and this
 * function exists so the matching *logic* itself (as opposed to the SQL
 * query) can be tested without a database.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function matchesTerritory(
  location: LeadLocationForMatching,
  territory: TerritoryCandidate,
): boolean {
  switch (territory.territoryType) {
    case "country":
      return equalsIgnoreCase(territory.country, location.country);
    case "state_province":
      return (
        equalsIgnoreCase(territory.stateProvince, location.stateProvince) &&
        equalsIgnoreCase(territory.country, location.country)
      );
    case "county":
      return (
        equalsIgnoreCase(territory.county, location.county) &&
        equalsIgnoreCase(territory.stateProvince, location.stateProvince) &&
        equalsIgnoreCase(territory.country, location.country)
      );
    case "city":
      return (
        equalsIgnoreCase(territory.city, location.city) &&
        equalsIgnoreCase(territory.stateProvince, location.stateProvince) &&
        equalsIgnoreCase(territory.country, location.country)
      );
    case "neighborhood":
      return (
        equalsIgnoreCase(territory.neighborhood, location.neighborhood) &&
        equalsIgnoreCase(territory.city, location.city) &&
        equalsIgnoreCase(territory.country, location.country)
      );
    case "postal_code":
      return equalsIgnoreCase(territory.postalCode, location.postalCode);
    case "radius":
      if (
        location.latitude == null ||
        location.longitude == null ||
        territory.centerLatitude == null ||
        territory.centerLongitude == null ||
        territory.radiusDistanceMeters == null
      ) {
        return false;
      }
      return (
        haversineDistanceMeters(
          location.latitude,
          location.longitude,
          territory.centerLatitude,
          territory.centerLongitude,
        ) <= territory.radiusDistanceMeters
      );
  }
}

/**
 * Matches a lead's location against every supported territory type (spec
 * §23), returning only active territories, sorted by priority ascending —
 * lower `priority` number wins (priority 1 outranks priority 100).
 */
export function matchTerritories(
  location: LeadLocationForMatching,
  territories: TerritoryCandidate[],
): TerritoryCandidate[] {
  return territories
    .filter(
      (territory) =>
        territory.status === "active" && matchesTerritory(location, territory),
    )
    .sort((a, b) => a.priority - b.priority);
}

/**
 * The single best (highest-priority) matching territory, or null if none
 * match — the common case routing/diagnostics will actually want.
 */
export function bestMatchingTerritory(
  location: LeadLocationForMatching,
  territories: TerritoryCandidate[],
): TerritoryCandidate | null {
  const matches = matchTerritories(location, territories);
  return matches[0] ?? null;
}
