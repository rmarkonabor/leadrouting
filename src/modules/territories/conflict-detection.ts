import {
  haversineDistanceMeters,
  matchTerritories,
  type LeadLocationForMatching,
} from "./match-territories";
import type { TerritoryCandidate } from "./match-territories";

export type ConflictSeverity = "blocking_error" | "warning" | "information";

export interface ConflictWarning {
  severity: ConflictSeverity;
  code: string;
  message: string;
  territoryIds: string[];
}

function territoryMatchKey(territory: TerritoryCandidate): string | null {
  switch (territory.territoryType) {
    case "country":
      return territory.country?.trim().toLowerCase() ?? null;
    case "state_province":
      return `${territory.country ?? ""}/${territory.stateProvince ?? ""}`.toLowerCase();
    case "county":
      return `${territory.country ?? ""}/${territory.stateProvince ?? ""}/${territory.county ?? ""}`.toLowerCase();
    case "city":
      return `${territory.country ?? ""}/${territory.stateProvince ?? ""}/${territory.city ?? ""}`.toLowerCase();
    case "neighborhood":
      return `${territory.country ?? ""}/${territory.city ?? ""}/${territory.neighborhood ?? ""}`.toLowerCase();
    case "postal_code":
      return territory.postalCode?.trim().toLowerCase() ?? null;
    case "radius":
      return null;
  }
}

/**
 * Detects two active territories that overlap (spec §24 item 1). For the
 * six exact-match territory types, "overlap" means two active territories
 * of the same type that would match the exact same lead location — the
 * concrete, always-determinable case (accidental duplicate territories).
 * For radius territories, overlap is the standard circle-intersection test.
 * A radius territory overlapping an exact-match territory (e.g. a city
 * territory whose true geographic boundary intersects a radius territory's
 * circle) is not determinable without real boundary/geocoding data and is a
 * documented limitation of this milestone.
 */
export function detectOverlappingTerritories(
  territories: TerritoryCandidate[],
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const active = territories.filter((t) => t.status === "active");

  const byKey = new Map<string, TerritoryCandidate[]>();
  for (const territory of active) {
    if (territory.territoryType === "radius") continue;
    const key = `${territory.territoryType}:${territoryMatchKey(territory)}`;
    if (territoryMatchKey(territory) === null) continue;
    const group = byKey.get(key) ?? [];
    group.push(territory);
    byKey.set(key, group);
  }

  for (const group of byKey.values()) {
    if (group.length > 1) {
      warnings.push({
        severity: "warning",
        code: "territories_overlap",
        message: `${group.length} active territories match the exact same location and overlap.`,
        territoryIds: group.map((t) => t.id),
      });
    }
  }

  const radiusTerritories = active.filter((t) => t.territoryType === "radius");
  for (let i = 0; i < radiusTerritories.length; i++) {
    for (let j = i + 1; j < radiusTerritories.length; j++) {
      const a = radiusTerritories[i];
      const b = radiusTerritories[j];
      if (
        !a ||
        !b ||
        a.centerLatitude == null ||
        a.centerLongitude == null ||
        a.radiusDistanceMeters == null ||
        b.centerLatitude == null ||
        b.centerLongitude == null ||
        b.radiusDistanceMeters == null
      ) {
        continue;
      }
      const distance = haversineDistanceMeters(
        a.centerLatitude,
        a.centerLongitude,
        b.centerLatitude,
        b.centerLongitude,
      );
      if (distance < a.radiusDistanceMeters + b.radiusDistanceMeters) {
        warnings.push({
          severity: "warning",
          code: "territories_overlap",
          message: "Two active radius territories overlap.",
          territoryIds: [a.id, b.id],
        });
      }
    }
  }

  return warnings;
}

export interface TerritoryRecipientInfo {
  territoryId: string;
  hasActiveDirectUser: boolean;
  hasTeamWithActiveMember: boolean;
}

/**
 * Detects active territories with no active recipient at all — neither a
 * directly assigned active user nor a linked team that itself has at least
 * one active member (spec §24 items 2, 3, 7, consolidated into one
 * "no active recipients" warning per this milestone's scope).
 */
export function detectTerritoriesWithoutActiveRecipients(
  territories: TerritoryCandidate[],
  recipientInfoByTerritoryId: Map<string, TerritoryRecipientInfo>,
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];

  for (const territory of territories) {
    if (territory.status !== "active") continue;
    const info = recipientInfoByTerritoryId.get(territory.id);
    const hasRecipient = info?.hasActiveDirectUser || info?.hasTeamWithActiveMember;

    if (!hasRecipient) {
      warnings.push({
        severity: "warning",
        code: "territory_no_active_recipients",
        message:
          "This territory has no active user or team assigned to receive its leads.",
        territoryIds: [territory.id],
      });
    }
  }

  return warnings;
}

/**
 * Detects active territories that would match the same location and share
 * the exact same priority — routing would have no deterministic way to
 * choose between them (spec §24 item 4, generalized beyond postal codes to
 * every exact-match territory type).
 */
export function detectEqualPriorityConflicts(
  territories: TerritoryCandidate[],
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const active = territories.filter(
    (t) => t.status === "active" && t.territoryType !== "radius",
  );

  const byKey = new Map<string, TerritoryCandidate[]>();
  for (const territory of active) {
    const matchKey = territoryMatchKey(territory);
    if (matchKey === null) continue;
    const key = `${territory.territoryType}:${matchKey}`;
    const group = byKey.get(key) ?? [];
    group.push(territory);
    byKey.set(key, group);
  }

  for (const group of byKey.values()) {
    const byPriority = new Map<number, TerritoryCandidate[]>();
    for (const territory of group) {
      const list = byPriority.get(territory.priority) ?? [];
      list.push(territory);
      byPriority.set(territory.priority, list);
    }
    for (const [priority, tied] of byPriority) {
      if (tied.length > 1) {
        warnings.push({
          severity: "blocking_error",
          code: "equal_priority_conflict",
          message: `${tied.length} territories share priority ${priority} for the same location — routing could not deterministically choose between them.`,
          territoryIds: tied.map((t) => t.id),
        });
      }
    }
  }

  return warnings;
}

/**
 * Detects locations actually observed on submitted leads that don't match
 * any active territory (spec §24 item 6, "an area has no configured
 * fallback") — determinable only for locations that have actually been
 * submitted, not for every hypothetical area, which is why the spec says
 * "where determinable."
 */
export function detectUncoveredLocations(
  observedLocations: Array<LeadLocationForMatching & { leadCount: number }>,
  territories: TerritoryCandidate[],
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];

  for (const location of observedLocations) {
    const matches = matchTerritories(location, territories);
    if (matches.length === 0) {
      const identifier =
        location.postalCode ??
        location.city ??
        location.stateProvince ??
        location.country ??
        "unknown location";
      warnings.push({
        severity: "information",
        code: "uncovered_area",
        message: `${location.leadCount} lead(s) submitted from "${identifier}" matched no active territory.`,
        territoryIds: [],
      });
    }
  }

  return warnings;
}
