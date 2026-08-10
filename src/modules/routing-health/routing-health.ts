import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { isAgent } from "@/lib/permissions/roles";
import { AppError, toAppError } from "@/lib/errors/app-error";

export interface RoutingHealthWindow {
  bucketStart: string;
  bucketEnd: string;
}

/**
 * Computes routing health metrics live for [bucketStart, bucketEnd) via the
 * `compute_routing_health` DB function (spec §45's 18 metrics). Per
 * docs/permissions-matrix.md, an agent may never view this dashboard;
 * org_admin and team_manager both may.
 *
 * Known gap (tracked in docs/decisions.md): `compute_routing_health` is
 * org-wide only — it has no team parameter — so a team_manager currently
 * sees the same org-wide numbers an org_admin does, rather than being
 * scoped to their permitted teams as the permissions matrix specifies.
 * Team-scoped metrics would require reworking every one of the 18
 * subqueries to join through `leads.assigned_team_id`; deferred rather than
 * rushed into this milestone's DB function.
 */
export async function getRoutingHealth(
  organizationSlug: string | undefined,
  window: RoutingHealthWindow,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  if (isAgent(membership.role)) {
    throw new AppError("forbidden", "Agents cannot view the routing health dashboard.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("compute_routing_health", {
    p_organization_id: membership.organizationId,
    p_bucket_start: window.bucketStart,
    p_bucket_end: window.bucketEnd,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
