import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { isAgent } from "@/lib/permissions/roles";
import { toAppError } from "@/lib/errors/app-error";

export interface DashboardSummary {
  leadsTotal: number;
  leadsAwaitingAcceptance: number;
  manualReviewOpenCount: number | null;
  unreadNotificationsCount: number;
}

/**
 * Quick counts for the dashboard landing page (spec §48.2). Every count
 * reuses the same RLS-scoped `.from(...)` queries the dedicated list pages
 * use, so a caller only ever sees numbers matching what they could actually
 * open — no separate visibility logic needed here.
 *
 * `manualReviewOpenCount` is `null` for an agent, who per
 * docs/permissions-matrix.md cannot view manual review at all — the
 * dashboard shows no manual-review tile rather than a misleading zero.
 */
export async function getDashboardSummary(
  organizationSlug: string | undefined,
): Promise<DashboardSummary> {
  const { user, membership } = await requireMembershipContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const [leadsResult, awaitingResult, manualReviewResult, notificationsResult] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organizationId),
      supabase
        .from("assignments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organizationId)
        .in("status", ["pending", "notified", "viewed"]),
      isAgent(membership.role)
        ? Promise.resolve({ count: null, error: null })
        : supabase
            .from("manual_review_items")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", membership.organizationId)
            .eq("status", "open"),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organizationId)
        .eq("user_id", user.id)
        .is("read_at", null),
    ]);

  if (leadsResult.error) throw toAppError(leadsResult.error);
  if (awaitingResult.error) throw toAppError(awaitingResult.error);
  if (manualReviewResult.error) throw toAppError(manualReviewResult.error);
  if (notificationsResult.error) throw toAppError(notificationsResult.error);

  return {
    leadsTotal: leadsResult.count ?? 0,
    leadsAwaitingAcceptance: awaitingResult.count ?? 0,
    manualReviewOpenCount: manualReviewResult.count,
    unreadNotificationsCount: notificationsResult.count ?? 0,
  };
}
