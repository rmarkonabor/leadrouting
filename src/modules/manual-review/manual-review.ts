import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type { ManualReviewReason } from "@/lib/supabase/database.types";

/**
 * Lists open manual review items (spec §35). Scoped by RLS: org_admin sees
 * all, a team_manager sees items for leads assigned to permitted teams.
 */
export async function listManualReviewItems(
  organizationSlug: string | undefined,
  filter?: { reason?: ManualReviewReason },
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("manual_review_items")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (filter?.reason) {
    query = query.eq("reason", filter.reason);
  }

  const { data, error } = await query;

  if (error) {
    throw toAppError(error);
  }

  return data;
}

async function setManualReviewStatus(
  organizationSlug: string | undefined,
  itemId: string,
  status: "resolved" | "dismissed",
) {
  // org_admin or a team_manager permitted for the lead's assigned team may
  // resolve/dismiss (docs/permissions-matrix.md "Manual review"); RLS's
  // manual_review_items_update_scoped policy is the actual gate — the
  // update below simply fails (0 rows) for anyone RLS excludes.
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("manual_review_items")
    .update({
      status,
      resolved_by_user_id: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Manual review item not found.");
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: status === "resolved" ? "manual_review_resolved" : "manual_review_dismissed",
    entityType: "manual_review_item",
    entityId: data.id,
  });

  return data;
}

/** Marks a manual review item resolved. org_admin/permitted team_manager. */
export async function resolveManualReviewItem(
  organizationSlug: string | undefined,
  itemId: string,
) {
  return setManualReviewStatus(organizationSlug, itemId, "resolved");
}

/** Dismisses a manual review item without resolving it. */
export async function dismissManualReviewItem(
  organizationSlug: string | undefined,
  itemId: string,
) {
  return setManualReviewStatus(organizationSlug, itemId, "dismissed");
}
