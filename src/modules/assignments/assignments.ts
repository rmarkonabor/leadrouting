import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

/**
 * Accepts an assignment (spec §31-§32). Any authenticated user may call
 * this — the `accept_assignment` Postgres function itself only mutates the
 * targeted row, and RLS's `assignments_update_scoped` policy (only the
 * assignee, a permitted team_manager, or org_admin) is the real gate.
 * Idempotent: accepting an already-accepted assignment is a no-op that
 * returns the current state (spec §32).
 */
export async function acceptAssignment(
  organizationSlug: string | undefined,
  assignmentId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (existingError || !existing) {
    throw new AppError("not_found", "Assignment not found.");
  }

  const { data, error } = await supabase.rpc("accept_assignment", {
    p_assignment_id: assignmentId,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/**
 * Declines an assignment (spec §31-§32). Idempotent; triggers reassignment
 * via `decline_assignment`'s internal call to `reassign_lead`.
 */
export async function declineAssignment(
  organizationSlug: string | undefined,
  assignmentId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (existingError || !existing) {
    throw new AppError("not_found", "Assignment not found.");
  }

  const { data, error } = await supabase.rpc("decline_assignment", {
    p_assignment_id: assignmentId,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/** Lists assignments visible to the caller, scoped by RLS. */
export async function listMyAssignments(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assignments")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/**
 * Marks an assignment viewed (spec §31 step 5) — fired when the assignee
 * opens the notification's lead link. Idempotent; a second call is a no-op.
 */
export async function markAssignmentViewed(
  organizationSlug: string | undefined,
  assignmentId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (existingError || !existing) {
    throw new AppError("not_found", "Assignment not found.");
  }

  const { data, error } = await supabase.rpc("mark_assignment_viewed", {
    p_assignment_id: assignmentId,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/** Lists routing/assignment attempt history for a lead (spec §31 step 11). */
export async function listAssignmentAttempts(
  organizationSlug: string | undefined,
  leadId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assignment_attempts")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
