import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

/** Lists the caller's own in-app notifications, newest first. RLS-scoped to self. */
export async function listNotifications(organizationSlug: string | undefined) {
  const { user } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notifications")
    .select()
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/** Marks one of the caller's own notifications read. RLS (`notifications_update_own_read_state`) is the real gate. */
export async function markNotificationRead(
  organizationSlug: string | undefined,
  notificationId: string,
) {
  const { user } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .single();

  if (existingError || !existing) {
    throw new AppError("not_found", "Notification not found.");
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    throw toAppError(error);
  }
}
