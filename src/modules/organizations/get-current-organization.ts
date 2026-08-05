import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import { AppError } from "@/lib/errors/app-error";
import type {
  OrganizationRole,
  OrganizationUserStatus,
} from "@/lib/supabase/database.types";

export interface CurrentOrganizationMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  status: OrganizationUserStatus;
}

/**
 * Lists every organization the verified caller is a member of. This is the
 * only source of tenant access — never derived from a client-supplied
 * value. See docs/security-model.md §1.
 */
export async function listMyMemberships(): Promise<CurrentOrganizationMembership[]> {
  const user = await getVerifiedUser();
  if (!user) {
    throw new AppError("unauthenticated", "You must be signed in.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_users")
    .select("organization_id, role, status")
    .eq("user_id", user.id);

  if (membershipsError) {
    throw new AppError("internal_error", "Could not load your organizations.", {
      cause: membershipsError,
    });
  }

  if (memberships.length === 0) {
    return [];
  }

  const organizationIds = memberships.map((m) => m.organization_id);
  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .in("id", organizationIds);

  if (organizationsError) {
    throw new AppError("internal_error", "Could not load your organizations.", {
      cause: organizationsError,
    });
  }

  const organizationsById = new Map(organizations.map((org) => [org.id, org]));

  return memberships.flatMap((membership) => {
    const organization = organizationsById.get(membership.organization_id);
    if (!organization) {
      // RLS may have hidden the organization row even though the
      // membership row is visible (e.g. a race with deletion) — skip
      // rather than surface a broken entry.
      return [];
    }
    return [
      {
        organizationId: membership.organization_id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        role: membership.role,
        status: membership.status,
      },
    ];
  });
}

/**
 * Resolves the active organization for this request. `requestedOrgSlug` is
 * only ever a hint (e.g. a route param) — it is matched against the
 * caller's verified, active memberships and never used directly as a query
 * filter. If it doesn't match a real active membership, this throws rather
 * than falling back silently, so a caller can't probe for the existence of
 * organizations they don't belong to. See docs/security-model.md §1 and
 * spec §9.
 */
export async function getCurrentOrganization(
  requestedOrgSlug?: string,
): Promise<CurrentOrganizationMembership> {
  const memberships = await listMyMemberships();
  const activeMemberships = memberships.filter((m) => m.status === "active");

  if (activeMemberships.length === 0) {
    throw new AppError(
      "no_organization_membership",
      "You do not have an active membership in any organization.",
    );
  }

  if (requestedOrgSlug) {
    const match = activeMemberships.find((m) => m.organizationSlug === requestedOrgSlug);
    if (!match) {
      throw new AppError(
        "organization_not_found_or_forbidden",
        "That organization is unavailable.",
      );
    }
    return match;
  }

  const [first] = activeMemberships;
  if (!first) {
    throw new AppError(
      "no_organization_membership",
      "You do not have an active membership in any organization.",
    );
  }
  return first;
}
