import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireMembershipContext,
  requireOrgAdminContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { logger } from "@/lib/logging/logger";
import type { AssignmentMethod } from "@/lib/supabase/database.types";

const createTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  defaultAssignmentMethod: z
    .enum(["direct", "round_robin", "weighted_round_robin"])
    .default("round_robin"),
  defaultAcceptanceDeadlineMinutes: z.number().int().positive().default(30),
  timezone: z.string().trim().min(1).default("UTC"),
});

export interface CreateTeamInput {
  name: string;
  description?: string;
  defaultAssignmentMethod?: AssignmentMethod;
  defaultAcceptanceDeadlineMinutes?: number;
  timezone?: string;
}

/**
 * Creates a team. org_admin only (docs/permissions-matrix.md "Create/update
 * teams") — enforced server-side via requireOrgAdminContext, backstopped by
 * RLS's teams_insert_org_admin policy.
 */
export async function createTeam(
  organizationSlug: string | undefined,
  input: CreateTeamInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createTeamInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the team details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("teams")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      default_assignment_method: parsed.data.defaultAssignmentMethod,
      default_acceptance_deadline_minutes: parsed.data.defaultAcceptanceDeadlineMinutes,
      timezone: parsed.data.timezone,
    })
    .select()
    .single();

  if (error) {
    logger.error("team_create_failed", {
      organization_id: membership.organizationId,
      error_code: error.code,
    });
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "team_created",
    entityType: "team",
    entityId: data.id,
    afterData: { name: data.name },
  });

  return data;
}

/**
 * Lists teams visible to the caller under the resolved organization (RLS
 * scopes rows for a non-admin caller, but per the permissions matrix every
 * active member may read the team list, so this function itself performs no
 * additional role check beyond an active membership).
 */
export async function listTeams(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("teams")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("name");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const addTeamMemberInputSchema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  isManager: z.boolean().default(false),
});

export interface AddTeamMemberInput {
  teamId: string;
  userId: string;
  isManager?: boolean;
}

/**
 * Adds a user to a team (and optionally marks them as that team's manager).
 * org_admin only — docs/permissions-matrix.md "Manage team membership" has
 * no team_manager capability at all, even for a team that user manages; only
 * org_admin can add/remove members or toggle is_manager
 * (docs/decisions.md ADR-007).
 */
export async function addTeamMember(
  organizationSlug: string | undefined,
  input: AddTeamMemberInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = addTeamMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the team member details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("team_users")
    .insert({
      organization_id: membership.organizationId,
      team_id: parsed.data.teamId,
      user_id: parsed.data.userId,
      is_manager: parsed.data.isManager,
    })
    .select()
    .single();

  if (error) {
    logger.error("team_member_add_failed", {
      organization_id: membership.organizationId,
      error_code: error.code,
    });
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "team_member_added",
    entityType: "team_users",
    entityId: data.id,
    afterData: {
      team_id: data.team_id,
      user_id: data.user_id,
      is_manager: data.is_manager,
    },
  });

  return data;
}

/**
 * Toggles a team_users row's is_manager flag. org_admin only — same
 * rationale as addTeamMember.
 */
export async function setTeamMemberManagerFlag(
  organizationSlug: string | undefined,
  teamUserId: string,
  isManager: boolean,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: before, error: beforeError } = await supabase
    .from("team_users")
    .select()
    .eq("id", teamUserId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (beforeError || !before) {
    throw new AppError("not_found", "Team membership not found.");
  }

  const { data, error } = await supabase
    .from("team_users")
    .update({ is_manager: isManager })
    .eq("id", teamUserId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "team_member_manager_flag_changed",
    entityType: "team_users",
    entityId: data.id,
    beforeData: { is_manager: before.is_manager },
    afterData: { is_manager: data.is_manager },
  });

  return data;
}

/**
 * Removes a user from a team. org_admin only.
 */
export async function removeTeamMember(
  organizationSlug: string | undefined,
  teamUserId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: before, error: beforeError } = await supabase
    .from("team_users")
    .select()
    .eq("id", teamUserId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (beforeError || !before) {
    throw new AppError("not_found", "Team membership not found.");
  }

  const { error } = await supabase
    .from("team_users")
    .delete()
    .eq("id", teamUserId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "team_member_removed",
    entityType: "team_users",
    entityId: teamUserId,
    beforeData: { team_id: before.team_id, user_id: before.user_id },
  });
}

/**
 * Lists members of a team, scoped by RLS: org_admin sees any team in their
 * org, a team_manager only a team they are `is_manager = true` on, an agent
 * only their own row (so this will return at most one row for an agent
 * caller — it is not meant to be their primary UI path).
 */
export async function listTeamMembers(
  organizationSlug: string | undefined,
  teamId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("team_users")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("team_id", teamId);

  if (error) {
    throw toAppError(error);
  }

  return data;
}
