import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

/**
 * Runs the routing simulator against a real, already-existing lead (spec
 * §34). org_admin only. Delegates to the `simulate_routing` Postgres
 * function, which shares its decision logic with `route_lead` but never
 * writes to leads/assignments/activities/routing_state/manual_review_items
 * — see docs/routing-engine.md §7 and this milestone's ADRs. This wrapper
 * itself performs no writes either.
 */
export async function simulateRouting(
  organizationSlug: string | undefined,
  leadId: string,
) {
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

  const { data, error } = await supabase.rpc("simulate_routing", { p_lead_id: leadId });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
