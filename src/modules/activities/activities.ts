import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";

/**
 * Lists the full activity timeline for a lead (spec §36.3 item 7), oldest
 * first so it reads chronologically. RLS (`activities_select_scoped`) gates
 * visibility — same lead-visibility join used everywhere else in the lead
 * detail view.
 */
export async function listActivities(
  organizationSlug: string | undefined,
  leadId: string,
) {
  await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw toAppError(error);
  }

  return data ?? [];
}
