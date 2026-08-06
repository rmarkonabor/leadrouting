import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import { listMyMemberships } from "@/modules/organizations/get-current-organization";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type {
  OrganizationRole,
  OrganizationUserStatus,
} from "@/lib/supabase/database.types";

/**
 * Lists every membership row in the resolved organization. org_admin only —
 * an agent/team_manager caller is rejected before any query runs (RLS's
 * `organization_users_select_fellow_member` policy from Milestone 1 would
 * technically let any active member read the full roster; this module
 * deliberately narrows that further at the server layer for the
 * administrative "Users" page, since roster management itself is an
 * org_admin capability per docs/permissions-matrix.md).
 */
export async function listOrganizationUsers(organizationSlug: string | undefined) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organization_users")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

async function loadMembershipRow(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  organizationUserId: string,
) {
  const { data, error } = await supabase
    .from("organization_users")
    .select()
    .eq("id", organizationUserId)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Membership not found.");
  }

  return data;
}

/**
 * Changes an org member's role. org_admin only
 * (docs/permissions-matrix.md "Assign roles"). A non-admin caller is
 * rejected by requireOrgAdminContext before this ever reaches a query — an
 * agent cannot promote themselves or anyone else, regardless of which
 * `organizationUserId` they pass in. RLS's
 * `organization_users_update_org_admin` policy (Milestone 1) is the backstop
 * if this server check were ever bypassed.
 */
export async function changeUserRole(
  organizationSlug: string | undefined,
  organizationUserId: string,
  newRole: OrganizationRole,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const before = await loadMembershipRow(
    supabase,
    membership.organizationId,
    organizationUserId,
  );

  const { data, error } = await supabase
    .from("organization_users")
    .update({ role: newRole })
    .eq("id", organizationUserId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "user_role_changed",
    entityType: "organization_users",
    entityId: data.id,
    beforeData: { role: before.role },
    afterData: { role: data.role },
  });

  return data;
}

async function setMembershipStatus(
  organizationSlug: string | undefined,
  organizationUserId: string,
  newStatus: OrganizationUserStatus,
  auditAction: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const before = await loadMembershipRow(
    supabase,
    membership.organizationId,
    organizationUserId,
  );

  const update: { status: OrganizationUserStatus; activated_at?: string } = {
    status: newStatus,
  };
  if (newStatus === "active" && before.status !== "active") {
    update.activated_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("organization_users")
    .update(update)
    .eq("id", organizationUserId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: auditAction,
    entityType: "organization_users",
    entityId: data.id,
    beforeData: { status: before.status },
    afterData: { status: data.status },
  });

  return data;
}

/**
 * Deactivates a member. Per spec §10: an inactive user must not access
 * protected application pages or receive new lead assignments — enforced
 * elsewhere by RLS's live status re-check (docs/security-model.md §1) and,
 * in a later milestone, by route_lead's eligibility filter. org_admin only.
 */
export async function deactivateUser(
  organizationSlug: string | undefined,
  organizationUserId: string,
) {
  return setMembershipStatus(
    organizationSlug,
    organizationUserId,
    "inactive",
    "user_deactivated",
  );
}

/**
 * Re-activates a previously deactivated (not "invited") member. org_admin
 * only.
 */
export async function activateUser(
  organizationSlug: string | undefined,
  organizationUserId: string,
) {
  return setMembershipStatus(
    organizationSlug,
    organizationUserId,
    "active",
    "user_activated",
  );
}

/**
 * Accepts an invitation: the invited person themselves transitions their own
 * `invited` membership to `active`. This is the one membership-status
 * mutation a non-admin may perform — but only for their own row (never
 * another user's). Deliberately does not go through
 * requireMembershipContext/getCurrentOrganization, since those only resolve
 * *active* memberships — an invited-but-not-yet-active membership must
 * still be resolvable by its own owner so they can accept it. Uses
 * `listMyMemberships` (unfiltered) instead, matched against the verified
 * caller's own memberships only, never a client-supplied organization id.
 */
export async function acceptInvitation(organizationSlug: string) {
  const user = await getVerifiedUser();
  if (!user) {
    throw new AppError("unauthenticated", "You must be signed in.");
  }

  const memberships = await listMyMemberships();
  const membership = memberships.find(
    (m) => m.organizationSlug === organizationSlug && m.status === "invited",
  );

  if (!membership) {
    throw new AppError(
      "organization_not_found_or_forbidden",
      "This invitation is no longer available.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organization_users")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("organization_id", membership.organizationId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "invitation_accepted",
    entityType: "organization_users",
    entityId: data.id,
  });

  return data;
}
