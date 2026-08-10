import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

/**
 * Assembles everything the lead detail page needs (spec §36.3) in one
 * call. RLS gates every underlying table read (`leads_select_scoped`,
 * `notes_select_scoped`, `activities_select_scoped`, `assignments_select_
 * scoped`) — a caller who can't see this lead gets a 404 from the first
 * query, never a partial detail view.
 *
 * The original raw submission payload (item 14) is the one field this
 * milestone gates with an explicit server-side check beyond RLS
 * (docs/permissions-matrix.md "View original raw payload ... Server"),
 * because `submission_logs` already restricts all columns to org_admin —
 * a team_manager/agent who can see the lead must still not see the
 * payload, so it's simply omitted rather than relying on a second table's
 * RLS to do it silently.
 */
export async function getLeadDetail(
  organizationSlug: string | undefined,
  leadId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (leadError || !lead) {
    throw new AppError("not_found", "Lead not found.");
  }

  const [
    customValuesResult,
    assignmentsResult,
    manualReviewResult,
    notesResult,
    activitiesResult,
    duplicateResult,
    statusHistoryResult,
  ] = await Promise.all([
    supabase
      .from("lead_custom_values")
      .select(
        "id, value, variable_definition_id, custom_variable_definitions(name, internal_key, field_type)",
      )
      .eq("lead_id", leadId),
    supabase
      .from("assignments")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    supabase
      .from("manual_review_items")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    supabase.from("lead_duplicates").select("*").eq("lead_id", leadId),
    supabase
      .from("lead_status_history")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
  ]);

  const latestAssignment =
    assignmentsResult.data?.[assignmentsResult.data.length - 1] ?? null;

  let originalPayload: unknown = null;
  if (membership.role === "org_admin") {
    const { data: submissionLog } = await supabase
      .from("submission_logs")
      .select("raw_payload, mapped_payload, status, created_at")
      .eq("resulting_lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    originalPayload = submissionLog ?? null;
  }

  return {
    lead,
    customValues: customValuesResult.error ? [] : (customValuesResult.data ?? []),
    assignments: assignmentsResult.error ? [] : (assignmentsResult.data ?? []),
    latestAssignment,
    assignmentExplanation: latestAssignment?.explanation ?? null,
    manualReviewItems: manualReviewResult.error ? [] : (manualReviewResult.data ?? []),
    notes: notesResult.error ? [] : (notesResult.data ?? []),
    activities: activitiesResult.error ? [] : (activitiesResult.data ?? []),
    duplicateInfo: duplicateResult.error ? [] : (duplicateResult.data ?? []),
    statusHistory: statusHistoryResult.error ? [] : (statusHistoryResult.data ?? []),
    // Integration status: no CRM/webhook integration exists until Milestone
    // 8 (external_record_links/webhook_deliveries don't exist yet) — this
    // is a deliberate, documented placeholder, not a bug.
    integrationStatus: { connected: false, note: "Integrations are Milestone 8 scope." },
    originalPayload,
    canViewOriginalPayload: membership.role === "org_admin",
  };
}

export async function updateLeadStatus(
  organizationSlug: string | undefined,
  leadId: string,
  newStatus: string,
) {
  await requireMembershipContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("update_lead_status", {
    p_lead_id: leadId,
    p_new_status: newStatus,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
