import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { mapPayload, type FieldMappingConfig } from "./map-payload";
import { validateLeadFields } from "@/modules/lead-intake/validate-lead-fields";
import {
  validateCustomValue,
  type CustomVariableDefinitionLike,
} from "./validate-custom-value";
import { findDuplicateMatch } from "@/modules/duplicate-detection/find-duplicate-match";
import { decideDuplicateOutcome } from "@/modules/duplicate-detection/decide-duplicate-outcome";
import type { LeadDuplicateAction } from "@/lib/supabase/database.types";

export interface MappingTesterResult {
  originalPayload: Record<string, unknown>;
  mappedLead: Record<string, unknown>;
  customValues: Record<string, unknown>;
  validationFailures: string[];
  unmappedFields: string[];
  duplicateResult: { matched: boolean; matchBasis: string | null; action: string | null };
  selectedRoutingFlow: null;
  simulatedAssignmentResult: "not_yet_available";
}

/**
 * The mapping tester (spec §19): runs a sample payload through the real
 * mapping/validation/duplicate-detection pipeline without persisting
 * anything (no submission_logs/leads rows), so an org_admin can verify a
 * source's configuration before going live. Routing/assignment simulation
 * is not yet available (Milestone 5) — reported as such rather than
 * omitted, per docs/implementation-plan.md Milestone 3's interface work.
 */
export async function testFieldMapping(
  organizationSlug: string | undefined,
  leadSourceId: string,
  samplePayload: Record<string, unknown>,
): Promise<MappingTesterResult> {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data: source, error: sourceError } = await supabase
    .from("lead_sources")
    .select()
    .eq("id", leadSourceId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (sourceError || !source) {
    throw new AppError("not_found", "Lead source not found.");
  }

  const { data: mappingRows, error: mappingError } = await supabase
    .from("field_mappings")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("lead_source_id", leadSourceId);

  if (mappingError) {
    throw toAppError(mappingError);
  }

  const mappings: FieldMappingConfig[] = (mappingRows ?? []).map((m) => ({
    sourceFieldName: m.source_field_name,
    destinationType: m.destination_type,
    destinationField: m.destination_field,
    dataType: m.data_type,
    required: m.required,
    defaultValue: m.default_value,
    transformation: m.transformation,
    validationRule: (m.validation_rule ?? {}) as FieldMappingConfig["validationRule"],
  }));

  const { mappedFields, customValues, unmappedFields } = mapPayload(
    samplePayload,
    mappings,
  );
  const fieldErrors = validateLeadFields(mappedFields, mappings);

  const { data: definitionRows } = await supabase
    .from("custom_variable_definitions")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("active", true);

  const customValueErrors: string[] = [];
  for (const definition of definitionRows ?? []) {
    const definitionLike: CustomVariableDefinitionLike = {
      internalKey: definition.internal_key,
      fieldType: definition.field_type,
      required: definition.required,
      options: definition.options,
      validationRules: (definition.validation_rules ??
        {}) as CustomVariableDefinitionLike["validationRules"],
    };
    const error = validateCustomValue(
      definitionLike,
      customValues[definition.internal_key],
    );
    if (error) {
      customValueErrors.push(error);
    }
  }

  const validationFailures = [...fieldErrors, ...customValueErrors];

  const { data: org } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", membership.organizationId)
    .single();

  const duplicateSettings =
    (
      org?.settings as {
        duplicateDetection?: { windowHours?: number; action?: LeadDuplicateAction };
      }
    )?.duplicateDetection ?? {};
  const windowHours = duplicateSettings.windowHours ?? 24;
  const configuredAction = duplicateSettings.action ?? "flag_and_continue";

  const match = await findDuplicateMatch(
    supabase,
    membership.organizationId,
    leadSourceId,
    {
      email: typeof mappedFields.email === "string" ? mappedFields.email : null,
      phone: typeof mappedFields.phone === "string" ? mappedFields.phone : null,
    },
    windowHours,
  );

  const outcome = decideDuplicateOutcome(match?.matchBasis ?? null, configuredAction);

  return {
    originalPayload: samplePayload,
    mappedLead: mappedFields,
    customValues,
    validationFailures,
    unmappedFields,
    duplicateResult: {
      matched: match !== null,
      matchBasis: match?.matchBasis ?? null,
      action: outcome.action,
    },
    selectedRoutingFlow: null,
    simulatedAssignmentResult: "not_yet_available",
  };
}
