import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";
import type { TerritoryCandidate } from "./match-territories";
import type { LeadLocationForMatching } from "./match-territories";
import {
  detectOverlappingTerritories,
  detectTerritoriesWithoutActiveRecipients,
  detectEqualPriorityConflicts,
  detectUncoveredLocations,
  type ConflictWarning,
  type TerritoryRecipientInfo,
} from "./conflict-detection";

/**
 * Fetches every territory (plus membership + a sample of recent lead
 * locations) for the organization and runs the full conflict/coverage
 * detection suite (spec §24). org_admin only — this is diagnostic
 * information for territory administration, not lead-facing data.
 */
export async function runTerritoryConflictDetection(
  organizationSlug: string | undefined,
): Promise<ConflictWarning[]> {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const [
    territoriesResult,
    territoryUsersResult,
    territoryTeamsResult,
    orgUsersResult,
    teamsResult,
    leadsResult,
  ] = await Promise.all([
    supabase
      .from("territories")
      .select()
      .eq("organization_id", membership.organizationId),
    supabase
      .from("territory_users")
      .select()
      .eq("organization_id", membership.organizationId),
    supabase
      .from("territory_teams")
      .select()
      .eq("organization_id", membership.organizationId),
    supabase
      .from("organization_users")
      .select("user_id, status")
      .eq("organization_id", membership.organizationId),
    supabase
      .from("teams")
      .select("id, status")
      .eq("organization_id", membership.organizationId),
    supabase
      .from("leads")
      .select("postal_code, city, state_province, country")
      .eq("organization_id", membership.organizationId)
      .not("postal_code", "is", null)
      .limit(500),
  ]);

  for (const result of [
    territoriesResult,
    territoryUsersResult,
    territoryTeamsResult,
    orgUsersResult,
    teamsResult,
    leadsResult,
  ]) {
    if (result.error) {
      throw toAppError(result.error);
    }
  }

  const territories: TerritoryCandidate[] = (territoriesResult.data ?? []).map((t) => ({
    id: t.id,
    territoryType: t.territory_type,
    country: t.country,
    stateProvince: t.state_province,
    county: t.county,
    city: t.city,
    neighborhood: t.neighborhood,
    postalCode: t.postal_code,
    centerLatitude: t.center_latitude,
    centerLongitude: t.center_longitude,
    radiusDistanceMeters: t.radius_distance,
    priority: t.priority,
    status: t.status,
  }));

  const activeUserIds = new Set(
    (orgUsersResult.data ?? [])
      .filter((u) => u.status === "active")
      .map((u) => u.user_id),
  );
  const activeTeamIds = new Set(
    (teamsResult.data ?? []).filter((t) => t.status === "active").map((t) => t.id),
  );

  const recipientInfoByTerritoryId = new Map<string, TerritoryRecipientInfo>();
  for (const territory of territories) {
    recipientInfoByTerritoryId.set(territory.id, {
      territoryId: territory.id,
      hasActiveDirectUser: false,
      hasTeamWithActiveMember: false,
    });
  }

  for (const row of territoryUsersResult.data ?? []) {
    const info = recipientInfoByTerritoryId.get(row.territory_id);
    if (info && activeUserIds.has(row.user_id)) {
      info.hasActiveDirectUser = true;
    }
  }

  for (const row of territoryTeamsResult.data ?? []) {
    const info = recipientInfoByTerritoryId.get(row.territory_id);
    if (info && activeTeamIds.has(row.team_id)) {
      info.hasTeamWithActiveMember = true;
    }
  }

  const locationCounts = new Map<
    string,
    LeadLocationForMatching & { leadCount: number }
  >();
  for (const lead of leadsResult.data ?? []) {
    const key = `${lead.postal_code}|${lead.city}|${lead.state_province}|${lead.country}`;
    const existing = locationCounts.get(key);
    if (existing) {
      existing.leadCount += 1;
    } else {
      locationCounts.set(key, {
        postalCode: lead.postal_code,
        city: lead.city,
        stateProvince: lead.state_province,
        country: lead.country,
        leadCount: 1,
      });
    }
  }

  return [
    ...detectOverlappingTerritories(territories),
    ...detectTerritoriesWithoutActiveRecipients(territories, recipientInfoByTerritoryId),
    ...detectEqualPriorityConflicts(territories),
    ...detectUncoveredLocations(Array.from(locationCounts.values()), territories),
  ];
}
