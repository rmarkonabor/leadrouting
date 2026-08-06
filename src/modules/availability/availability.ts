import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireMembershipContext,
  requireOrgAdminContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

/**
 * Spec §12 / docs/database-schema.md §3. `user_availability` and the
 * self-editable half of `user_assignment_settings` (accept_leads, timezone,
 * working_hours) are what an agent may change about themselves
 * (docs/permissions-matrix.md "View own profile / update own availability").
 * `daily_lead_limit`, `active_lead_limit`, and `assignment_weight` are
 * org_admin-configured only — RLS allows a self-row UPDATE, but this module
 * never accepts those three fields from a non-admin caller, so a non-admin
 * cannot set their own capacity/weight even though the row-level RLS check
 * alone would technically permit the UPDATE statement. This is the "server
 * layer restricts which columns" half of the "Both" enforcement note on the
 * user_assignment_settings table.
 */

const updateOwnAvailabilityInputSchema = z.object({
  availabilityStatus: z.enum(["available", "busy", "away", "vacation", "offline"]),
  statusNote: z.string().trim().max(500).optional(),
});

export interface UpdateOwnAvailabilityInput {
  availabilityStatus: "available" | "busy" | "away" | "vacation" | "offline";
  statusNote?: string;
}

export async function updateOwnAvailability(
  organizationSlug: string | undefined,
  input: UpdateOwnAvailabilityInput,
) {
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const parsed = updateOwnAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check your availability update.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_availability")
    .upsert(
      {
        organization_id: membership.organizationId,
        user_id: user.id,
        availability_status: parsed.data.availabilityStatus,
        status_note: parsed.data.statusNote ?? null,
        updated_by_user_id: user.id,
      },
      { onConflict: "organization_id,user_id" },
    )
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const selfEditableAssignmentSettingsSchema = z.object({
  acceptLeads: z.boolean().optional(),
  timezone: z.string().trim().min(1).optional(),
  workingHours: z.record(z.string(), z.unknown()).optional(),
});

export interface UpdateOwnAssignmentSettingsInput {
  acceptLeads?: boolean;
  timezone?: string;
  workingHours?: Record<string, unknown>;
}

export async function updateOwnAssignmentSettings(
  organizationSlug: string | undefined,
  input: UpdateOwnAssignmentSettingsInput,
) {
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const parsed = selfEditableAssignmentSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check your settings.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_assignment_settings")
    .upsert(
      {
        organization_id: membership.organizationId,
        user_id: user.id,
        ...(parsed.data.acceptLeads !== undefined
          ? { accept_leads: parsed.data.acceptLeads }
          : {}),
        ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
        ...(parsed.data.workingHours !== undefined
          ? { working_hours: parsed.data.workingHours }
          : {}),
      },
      { onConflict: "organization_id,user_id" },
    )
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const capacityInputSchema = z.object({
  dailyLeadLimit: z.number().int().min(0).optional(),
  activeLeadLimit: z.number().int().min(0).optional(),
  assignmentWeight: z.number().int().positive().optional(),
});

export interface UpdateUserCapacityInput {
  dailyLeadLimit?: number;
  activeLeadLimit?: number;
  assignmentWeight?: number;
}

/**
 * Admin-only override of a specific user's capacity/weight (spec §12,
 * "Administrators may override availability and capacity"). Distinct from
 * updateOwnAssignmentSettings — this is the only path that can touch
 * daily_lead_limit/active_lead_limit/assignment_weight, and it targets an
 * arbitrary `targetUserId` rather than the caller.
 */
export async function updateUserCapacity(
  organizationSlug: string | undefined,
  targetUserId: string,
  input: UpdateUserCapacityInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = capacityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the capacity values.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data: before } = await supabase
    .from("user_assignment_settings")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("user_assignment_settings")
    .upsert(
      {
        organization_id: membership.organizationId,
        user_id: targetUserId,
        ...(parsed.data.dailyLeadLimit !== undefined
          ? { daily_lead_limit: parsed.data.dailyLeadLimit }
          : {}),
        ...(parsed.data.activeLeadLimit !== undefined
          ? { active_lead_limit: parsed.data.activeLeadLimit }
          : {}),
        ...(parsed.data.assignmentWeight !== undefined
          ? { assignment_weight: parsed.data.assignmentWeight }
          : {}),
      },
      { onConflict: "organization_id,user_id" },
    )
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "user_capacity_overridden",
    entityType: "user_assignment_settings",
    entityId: data.id,
    beforeData: before
      ? {
          daily_lead_limit: before.daily_lead_limit,
          active_lead_limit: before.active_lead_limit,
          assignment_weight: before.assignment_weight,
        }
      : null,
    afterData: {
      daily_lead_limit: data.daily_lead_limit,
      active_lead_limit: data.active_lead_limit,
      assignment_weight: data.assignment_weight,
    },
  });

  return data;
}

export async function getOwnAvailability(organizationSlug: string | undefined) {
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const [{ data: availability }, { data: settings }] = await Promise.all([
    supabase
      .from("user_availability")
      .select()
      .eq("organization_id", membership.organizationId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_assignment_settings")
      .select()
      .eq("organization_id", membership.organizationId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return { availability, settings };
}
