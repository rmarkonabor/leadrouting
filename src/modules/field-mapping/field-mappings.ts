import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type {
  FieldMappingDestinationType,
  FieldMappingTransformation,
} from "@/lib/supabase/database.types";

const fieldMappingInputSchema = z.object({
  leadSourceId: z.uuid(),
  sourceFieldName: z.string().trim().min(1).max(200),
  destinationType: z.enum(["default_field", "custom_variable", "ignored"]),
  destinationField: z.string().trim().min(1).max(200).optional(),
  dataType: z.string().trim().min(1).max(50),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  transformation: z
    .enum([
      "trim",
      "lowercase",
      "uppercase",
      "normalize_email",
      "normalize_phone",
      "parse_number",
      "parse_currency",
      "to_boolean",
      "split_full_name",
      "join_values",
      "replace_values",
      "apply_default",
    ])
    .optional(),
  validationRule: z.record(z.string(), z.unknown()).default({}),
});

export interface FieldMappingInput {
  leadSourceId: string;
  sourceFieldName: string;
  destinationType: FieldMappingDestinationType;
  destinationField?: string;
  dataType: string;
  required?: boolean;
  defaultValue?: unknown;
  transformation?: FieldMappingTransformation;
  validationRule?: Record<string, unknown>;
}

/**
 * Creates or replaces (upsert on `(lead_source_id, source_field_name)`) one
 * field mapping row. org_admin only (docs/permissions-matrix.md "Configure
 * field mappings").
 */
export async function upsertFieldMapping(
  organizationSlug: string | undefined,
  input: FieldMappingInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = fieldMappingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the field mapping details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (parsed.data.destinationType !== "ignored" && !parsed.data.destinationField) {
    throw new AppError(
      "invalid_input",
      "A destination field is required unless the mapping is ignored.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("field_mappings")
    .upsert(
      {
        organization_id: membership.organizationId,
        lead_source_id: parsed.data.leadSourceId,
        source_field_name: parsed.data.sourceFieldName,
        destination_type: parsed.data.destinationType,
        destination_field: parsed.data.destinationField ?? null,
        data_type: parsed.data.dataType,
        required: parsed.data.required,
        default_value: parsed.data.defaultValue ?? null,
        transformation: parsed.data.transformation ?? null,
        validation_rule: parsed.data.validationRule,
      },
      { onConflict: "lead_source_id,source_field_name" },
    )
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "field_mapping_saved",
    entityType: "field_mapping",
    entityId: data.id,
    afterData: {
      lead_source_id: data.lead_source_id,
      source_field_name: data.source_field_name,
      destination_type: data.destination_type,
    },
  });

  return data;
}

/**
 * Lists field mappings for one lead source. org_admin only.
 */
export async function listFieldMappings(
  organizationSlug: string | undefined,
  leadSourceId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("field_mappings")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("lead_source_id", leadSourceId)
    .order("source_field_name");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/**
 * Deletes a field mapping. org_admin only.
 */
export async function deleteFieldMapping(
  organizationSlug: string | undefined,
  fieldMappingId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("field_mappings")
    .delete()
    .eq("id", fieldMappingId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "field_mapping_deleted",
    entityType: "field_mapping",
    entityId: fieldMappingId,
  });
}
