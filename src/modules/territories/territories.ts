import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireOrgAdminContext,
  requireMembershipContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { isPostgisAvailable } from "./postgis-availability";
import type { TerritoryType } from "@/lib/supabase/database.types";

const TERRITORY_TYPE_FIELD: Record<Exclude<TerritoryType, "radius">, string> = {
  country: "country",
  state_province: "stateProvince",
  county: "county",
  city: "city",
  neighborhood: "neighborhood",
  postal_code: "postalCode",
};

const createTerritoryInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  territoryType: z.enum([
    "country",
    "state_province",
    "county",
    "city",
    "neighborhood",
    "postal_code",
    "radius",
  ]),
  country: z.string().trim().min(1).optional(),
  stateProvince: z.string().trim().min(1).optional(),
  county: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  neighborhood: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  centerLatitude: z.number().min(-90).max(90).optional(),
  centerLongitude: z.number().min(-180).max(180).optional(),
  radiusDistance: z.number().positive().optional(),
  priority: z.number().int().min(1).max(100000).default(100),
  status: z.enum(["active", "inactive"]).default("active"),
  effectiveStartDate: z.string().optional(),
  effectiveEndDate: z.string().optional(),
});

export type CreateTerritoryInput = z.input<typeof createTerritoryInputSchema>;

async function assertTerritoryFieldsValid(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  input: z.infer<typeof createTerritoryInputSchema>,
) {
  if (input.territoryType === "radius") {
    if (
      input.centerLatitude === undefined ||
      input.centerLongitude === undefined ||
      input.radiusDistance === undefined
    ) {
      throw new AppError(
        "invalid_input",
        "Radius territories require a center latitude, longitude, and radius distance.",
      );
    }

    const available = await isPostgisAvailable(supabase);
    if (!available) {
      throw new AppError(
        "invalid_input",
        "Radius territories are not available: PostGIS is not enabled on this database.",
      );
    }
    return;
  }

  const field = TERRITORY_TYPE_FIELD[input.territoryType];
  if (!input[field as keyof typeof input]) {
    throw new AppError(
      "invalid_input",
      `A ${field} value is required for this territory type.`,
    );
  }
}

/**
 * Creates a territory. org_admin only (docs/permissions-matrix.md
 * "Create/update territories, resolve conflicts"). Radius territories are
 * rejected unless `is_postgis_available()` reports true at the moment of
 * creation — spec §23 requirement 7 is a live capability gate, not an
 * assumption.
 */
export async function createTerritory(
  organizationSlug: string | undefined,
  input: CreateTerritoryInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createTerritoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the territory details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  await assertTerritoryFieldsValid(supabase, parsed.data);

  const { data, error } = await supabase
    .from("territories")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      territory_type: parsed.data.territoryType,
      country: parsed.data.country ?? null,
      state_province: parsed.data.stateProvince ?? null,
      county: parsed.data.county ?? null,
      city: parsed.data.city ?? null,
      neighborhood: parsed.data.neighborhood ?? null,
      postal_code: parsed.data.postalCode ?? null,
      priority: parsed.data.priority,
      status: parsed.data.status,
      effective_start_date: parsed.data.effectiveStartDate ?? null,
      effective_end_date: parsed.data.effectiveEndDate ?? null,
      ...(parsed.data.territoryType === "radius"
        ? {
            center_geography: `SRID=4326;POINT(${parsed.data.centerLongitude} ${parsed.data.centerLatitude})`,
            center_latitude: parsed.data.centerLatitude,
            center_longitude: parsed.data.centerLongitude,
            radius_distance: parsed.data.radiusDistance,
          }
        : {}),
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_created",
    entityType: "territory",
    entityId: data.id,
    afterData: { name: data.name, territory_type: data.territory_type },
  });

  return data;
}

/**
 * Lists territories for the resolved organization. Any active member may
 * read (mirrors teams — territory names/types are not sensitive).
 */
export async function listTerritories(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("territories")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("priority");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const updateTerritoryInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(1).max(100000).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  effectiveStartDate: z.string().nullable().optional(),
  effectiveEndDate: z.string().nullable().optional(),
});

export type UpdateTerritoryInput = z.infer<typeof updateTerritoryInputSchema>;

/**
 * Updates a territory's name/priority/status/effective dates. org_admin
 * only. Geographic identity fields (country/state/etc., center/radius) are
 * intentionally not editable here — changing a territory's geographic
 * definition is a delete-and-recreate, so conflict detection always runs
 * against a stable set of territory definitions.
 */
export async function updateTerritory(
  organizationSlug: string | undefined,
  territoryId: string,
  input: UpdateTerritoryInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = updateTerritoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the territory details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const update: {
    name?: string;
    priority?: number;
    status?: "active" | "inactive";
    effective_start_date?: string | null;
    effective_end_date?: string | null;
  } = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.priority !== undefined) update.priority = parsed.data.priority;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.effectiveStartDate !== undefined)
    update.effective_start_date = parsed.data.effectiveStartDate;
  if (parsed.data.effectiveEndDate !== undefined)
    update.effective_end_date = parsed.data.effectiveEndDate;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("territories")
    .update(update)
    .eq("id", territoryId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_updated",
    entityType: "territory",
    entityId: data.id,
    afterData: update,
  });

  return data;
}

/**
 * Deletes a territory. org_admin only.
 */
export async function deleteTerritory(
  organizationSlug: string | undefined,
  territoryId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("territories")
    .delete()
    .eq("id", territoryId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_deleted",
    entityType: "territory",
    entityId: territoryId,
  });
}

/**
 * Adds a user to a territory (spec §23: "Territories may belong to a
 * user"). org_admin only.
 */
export async function addTerritoryUser(
  organizationSlug: string | undefined,
  territoryId: string,
  userId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("territory_users")
    .insert({
      organization_id: membership.organizationId,
      territory_id: territoryId,
      user_id: userId,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_user_added",
    entityType: "territory_users",
    entityId: data.id,
    afterData: { territory_id: data.territory_id, user_id: data.user_id },
  });

  return data;
}

export async function removeTerritoryUser(
  organizationSlug: string | undefined,
  territoryUserId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("territory_users")
    .delete()
    .eq("id", territoryUserId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_user_removed",
    entityType: "territory_users",
    entityId: territoryUserId,
  });
}

/**
 * Adds a team to a territory (spec §23: "Territories may belong to a
 * team"). org_admin only.
 */
export async function addTerritoryTeam(
  organizationSlug: string | undefined,
  territoryId: string,
  teamId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("territory_teams")
    .insert({
      organization_id: membership.organizationId,
      territory_id: territoryId,
      team_id: teamId,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_team_added",
    entityType: "territory_teams",
    entityId: data.id,
    afterData: { territory_id: data.territory_id, team_id: data.team_id },
  });

  return data;
}

export async function removeTerritoryTeam(
  organizationSlug: string | undefined,
  territoryTeamId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("territory_teams")
    .delete()
    .eq("id", territoryTeamId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "territory_team_removed",
    entityType: "territory_teams",
    entityId: territoryTeamId,
  });
}

/**
 * Lists user/team membership for one territory. Any active member may
 * read, scoped by territory_users/territory_teams RLS.
 */
export async function listTerritoryMembership(
  organizationSlug: string | undefined,
  territoryId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const [usersResult, teamsResult] = await Promise.all([
    supabase
      .from("territory_users")
      .select()
      .eq("organization_id", membership.organizationId)
      .eq("territory_id", territoryId),
    supabase
      .from("territory_teams")
      .select()
      .eq("organization_id", membership.organizationId)
      .eq("territory_id", territoryId),
  ]);

  if (usersResult.error) {
    throw toAppError(usersResult.error);
  }
  if (teamsResult.error) {
    throw toAppError(teamsResult.error);
  }

  return { users: usersResult.data, teams: teamsResult.data };
}
