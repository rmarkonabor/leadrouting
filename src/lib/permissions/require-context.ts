import "server-only";
import type { User } from "@supabase/supabase-js";
import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import {
  getCurrentOrganization,
  type CurrentOrganizationMembership,
} from "@/modules/organizations/get-current-organization";
import { assertOrgAdmin } from "./roles";
import { AppError } from "@/lib/errors/app-error";

export interface MembershipContext {
  user: User;
  membership: CurrentOrganizationMembership;
}

/**
 * Resolves the verified caller and their active membership in the requested
 * organization. `organizationSlug` is only ever a hint (e.g. a route param)
 * — never trusted directly — and is validated against the caller's real,
 * active memberships by `getCurrentOrganization`. See
 * docs/security-model.md §1 and spec §9. Every module action in this
 * milestone goes through this helper (or `requireOrgAdminContext` below)
 * rather than accepting an `organizationId` argument from its caller.
 */
export async function requireMembershipContext(
  organizationSlug?: string,
): Promise<MembershipContext> {
  const user = await getVerifiedUser();
  if (!user) {
    throw new AppError("unauthenticated", "You must be signed in.");
  }

  const membership = await getCurrentOrganization(organizationSlug);
  return { user, membership };
}

/**
 * Same as `requireMembershipContext`, but additionally asserts the caller's
 * role in the resolved organization is org_admin. This is the standard entry
 * point for every org_admin-only capability in
 * docs/permissions-matrix.md (invite users, manage teams, configure
 * recipient attributes, run imports, etc.) — the server-side half of "Both"
 * enforcement, run before RLS is ever reached.
 */
export async function requireOrgAdminContext(
  organizationSlug?: string,
): Promise<MembershipContext> {
  const context = await requireMembershipContext(organizationSlug);
  assertOrgAdmin(context.membership.role);
  return context;
}
