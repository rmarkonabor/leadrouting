import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

/**
 * Manually (re-)triggers live routing for a lead — e.g. "rerun live
 * routing" from the manual review queue (spec §35). org_admin only.
 * Delegates entirely to the `route_lead` Postgres function
 * (docs/routing-engine.md §5); this wrapper performs no routing logic
 * itself.
 */
export async function routeLead(organizationSlug: string | undefined, leadId: string) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (leadError || !lead) {
    throw new AppError("not_found", "Lead not found.");
  }

  const { data, error } = await supabase.rpc("route_lead", { p_lead_id: leadId });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
