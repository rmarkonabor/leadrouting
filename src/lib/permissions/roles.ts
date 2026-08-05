import type {
  OrganizationRole,
  OrganizationUserStatus,
} from "@/lib/supabase/database.types";
import { AppError } from "@/lib/errors/app-error";

/**
 * Pure, DB-free role/status checks (docs/permissions-matrix.md). These are
 * the server-side half of the "Both" enforcement layer — RLS is the
 * backstop, these are the first line of defense that runs before a query is
 * even issued (docs/security-model.md §1).
 */

export function isOrgAdmin(role: OrganizationRole): boolean {
  return role === "org_admin";
}

export function isTeamManager(role: OrganizationRole): boolean {
  return role === "team_manager";
}

export function isAgent(role: OrganizationRole): boolean {
  return role === "agent";
}

export function isActiveMembership(status: OrganizationUserStatus): boolean {
  return status === "active";
}

/**
 * Throws if the membership is not active. Per spec §10: an inactive or
 * suspended user must not access protected application pages regardless of
 * role.
 */
export function assertActiveMembership(status: OrganizationUserStatus): void {
  if (!isActiveMembership(status)) {
    throw new AppError(
      "forbidden",
      "Your access to this organization is not currently active.",
    );
  }
}

/**
 * Throws unless the caller is an org_admin. Per docs/permissions-matrix.md,
 * organization settings, member management, and integration configuration
 * are org_admin-only regardless of team scope.
 */
export function assertOrgAdmin(role: OrganizationRole): void {
  if (!isOrgAdmin(role)) {
    throw new AppError(
      "forbidden",
      "This action requires an organization administrator.",
    );
  }
}
