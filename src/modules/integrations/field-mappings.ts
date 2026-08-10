import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";
import type { FieldMappingTransformation } from "@/lib/supabase/database.types";

const upsertFieldMappingSchema = z.object({
  sourceField: z.string().trim().min(1).max(200),
  crmField: z.string().trim().min(1).max(200),
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
    .nullable()
    .optional(),
});

export interface UpsertFieldMappingInput {
  sourceField: string;
  crmField: string;
  transformation?: FieldMappingTransformation | null;
}

export async function listFieldMappings(
  organizationSlug: string | undefined,
  connectionId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("integration_field_mappings")
    .select("*")
    .eq("organization_id", membership.organizationId)
    .eq("integration_connection_id", connectionId)
    .order("source_field", { ascending: true });

  if (error) throw toAppError(error);
  return data ?? [];
}

/** Source-field name (default field) or "custom:<internal_key>" for a custom variable — spec §42 items 3-4. */
export async function upsertFieldMapping(
  organizationSlug: string | undefined,
  connectionId: string,
  input: UpsertFieldMappingInput,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const parsed = upsertFieldMappingSchema.parse(input);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("integration_field_mappings")
    .upsert(
      {
        organization_id: membership.organizationId,
        integration_connection_id: connectionId,
        source_field: parsed.sourceField,
        crm_field: parsed.crmField,
        transformation: parsed.transformation ?? null,
      },
      { onConflict: "integration_connection_id,source_field" },
    )
    .select()
    .single();

  if (error) throw toAppError(error);
  return data;
}

export async function deleteFieldMapping(
  organizationSlug: string | undefined,
  mappingId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("integration_field_mappings")
    .delete()
    .eq("id", mappingId)
    .eq("organization_id", membership.organizationId);

  if (error) throw toAppError(error);
}
