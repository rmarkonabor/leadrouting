import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface WebhookEventPayload {
  eventId: string;
  eventType: string;
  organizationId: string;
  timestamp: string;
  lead: Record<string, unknown> | null;
  customVariables: Record<string, unknown>;
  assignment: Record<string, unknown> | null;
}

/**
 * Composes the required fields for a webhook delivery (spec §43): unique
 * event id, event type, organization id, timestamp, lead information,
 * custom variables, assignment information. Resolved fresh at delivery
 * time from `eventId` (the integration_jobs id) plus the job payload's
 * lead_id/assignment_id — same "compose at dispatch, not at enqueue"
 * pattern as the CRM sync payload and Milestone 6's notification content
 * resolver, so a retried delivery always reflects current state.
 */
export async function buildWebhookEventPayload(
  supabase: SupabaseClient<Database>,
  eventId: string,
  eventType: string,
  organizationId: string,
  jobPayload: Record<string, unknown>,
): Promise<WebhookEventPayload> {
  const leadId = typeof jobPayload.lead_id === "string" ? jobPayload.lead_id : null;
  const assignmentId =
    typeof jobPayload.assignment_id === "string" ? jobPayload.assignment_id : null;

  const [leadResult, customValuesResult, assignmentResult] = await Promise.all([
    leadId
      ? supabase.from("leads").select("*").eq("id", leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    leadId
      ? supabase
          .from("lead_custom_values")
          .select("value, variable_definition_id")
          .eq("lead_id", leadId)
      : Promise.resolve({
          data: [] as Array<{ value: unknown; variable_definition_id: string }>,
        }),
    assignmentId
      ? supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const customValues = customValuesResult.data ?? [];
  const definitionIds = customValues.map((row) => row.variable_definition_id);
  const { data: definitions } = definitionIds.length
    ? await supabase
        .from("custom_variable_definitions")
        .select("id, internal_key")
        .in("id", definitionIds)
    : { data: [] as Array<{ id: string; internal_key: string }> };
  const internalKeyById = new Map((definitions ?? []).map((d) => [d.id, d.internal_key]));

  const customVariables: Record<string, unknown> = {};
  for (const row of customValues) {
    const internalKey = internalKeyById.get(row.variable_definition_id);
    if (internalKey) customVariables[internalKey] = row.value;
  }

  return {
    eventId,
    eventType,
    organizationId,
    timestamp: new Date().toISOString(),
    lead: leadResult.data as Record<string, unknown> | null,
    customVariables,
    assignment: assignmentResult.data as Record<string, unknown> | null,
  };
}
