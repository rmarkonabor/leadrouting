import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { applyTransformation } from "@/modules/field-mapping/transformations";
import { formatRoutingExplanation } from "@/modules/routing/format-explanation";
import type { CrmContactInput } from "./crm-adapter";

export interface SyncContactPayload {
  contact: CrmContactInput;
  ownerCrmExternalId: string | null;
  explanationNote: string | null;
}

/**
 * Composes everything a `sync_contact` crm_sync job needs, resolved fresh
 * at delivery time (not stored at enqueue time) so a retried job always
 * reflects current lead/assignment state — same "compose at dispatch"
 * pattern as Milestone 6's notification content resolver. Applies
 * `integration_field_mappings` (spec §42 items 3-4: source information +
 * mapped custom variables) via the same twelve transformations lead-intake
 * field mapping uses.
 */
export async function buildSyncContactPayload(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  leadId: string,
): Promise<SyncContactPayload> {
  const [
    leadResult,
    mappingsResult,
    customValuesResult,
    linkResult,
    assignmentResult,
    connectionResult,
  ] = await Promise.all([
    supabase.from("leads").select("*").eq("id", leadId).single(),
    supabase
      .from("integration_field_mappings")
      .select("*")
      .eq("integration_connection_id", connectionId),
    supabase
      .from("lead_custom_values")
      .select("value, variable_definition_id")
      .eq("lead_id", leadId),
    supabase
      .from("external_record_links")
      .select("external_record_id")
      .eq("integration_connection_id", connectionId)
      .eq("lead_id", leadId)
      .maybeSingle(),
    supabase
      .from("assignments")
      .select("user_id, explanation")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("integration_connections")
      .select("settings")
      .eq("id", connectionId)
      .single(),
  ]);

  if (leadResult.error || !leadResult.data) {
    throw new Error(`Lead ${leadId} not found while building CRM sync payload.`);
  }

  const lead = leadResult.data;
  const customValues = customValuesResult.data ?? [];
  const definitionIds = customValues.map((row) => row.variable_definition_id);
  const { data: definitions } = definitionIds.length
    ? await supabase
        .from("custom_variable_definitions")
        .select("id, internal_key")
        .in("id", definitionIds)
    : { data: [] as Array<{ id: string; internal_key: string }> };

  const internalKeyById = new Map((definitions ?? []).map((d) => [d.id, d.internal_key]));
  const customValuesByKey = new Map<string, unknown>();
  for (const row of customValues) {
    const internalKey = internalKeyById.get(row.variable_definition_id);
    if (internalKey) customValuesByKey.set(internalKey, row.value);
  }

  const fields: Record<string, unknown> = {};
  for (const mapping of mappingsResult.data ?? []) {
    const rawValue = mapping.source_field.startsWith("custom:")
      ? customValuesByKey.get(mapping.source_field.slice("custom:".length))
      : (lead as unknown as Record<string, unknown>)[mapping.source_field];
    fields[mapping.crm_field] = applyTransformation(mapping.transformation, rawValue);
  }

  // Source information (spec §42 item 3), always sent regardless of an
  // explicit field mapping — the CRM should always know where a lead came
  // from.
  fields.leadSourceId = lead.lead_source_id;
  fields.campaign = lead.campaign;
  fields.medium = lead.medium;

  const contact: CrmContactInput = {
    externalRecordId: linkResult.data?.external_record_id,
    firstName: lead.first_name ?? undefined,
    lastName: lead.last_name ?? undefined,
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    fields,
  };

  const ownerUserId = assignmentResult.data?.user_id ?? null;
  const ownerMapping =
    ((connectionResult.data?.settings as Record<string, unknown> | undefined)
      ?.ownerMapping as Record<string, string> | undefined) ?? {};
  const ownerCrmExternalId = ownerUserId ? (ownerMapping[ownerUserId] ?? null) : null;

  const explanationNote = assignmentResult.data?.explanation
    ? formatRoutingExplanation(
        assignmentResult.data.explanation as unknown as Parameters<
          typeof formatRoutingExplanation
        >[0],
      )
    : null;

  return { contact, ownerCrmExternalId, explanationNote };
}
