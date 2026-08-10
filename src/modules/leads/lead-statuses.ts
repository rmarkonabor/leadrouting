import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";

/** Active lead statuses for the caller's org, in display order (spec §37). */
export async function listLeadStatusDefinitions(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("lead_status_definitions")
    .select("key, label, sort_order")
    .eq("organization_id", membership.organizationId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw toAppError(error);

  return data ?? [];
}
