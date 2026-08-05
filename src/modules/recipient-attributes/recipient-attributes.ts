import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireMembershipContext,
  requireOrgAdminContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type { AttributeFieldType } from "@/lib/supabase/database.types";

const ATTRIBUTE_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "single_select",
  "multi_select",
  "email",
  "phone",
  "url",
] as const satisfies readonly AttributeFieldType[];

const createDefinitionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  internalKey: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only."),
  description: z.string().trim().max(2000).optional(),
  fieldType: z.enum(ATTRIBUTE_FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.unknown()).default([]),
});

export interface CreateRecipientAttributeDefinitionInput {
  name: string;
  internalKey: string;
  description?: string;
  fieldType: AttributeFieldType;
  required?: boolean;
  options?: unknown[];
}

/**
 * Creates a recipient attribute definition (spec §13). org_admin only per
 * docs/permissions-matrix.md; the internal key is unique per organization
 * (enforced by RLS-independent DB constraint too — see the migration).
 */
export async function createRecipientAttributeDefinition(
  organizationSlug: string | undefined,
  input: CreateRecipientAttributeDefinitionInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createDefinitionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the attribute details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("recipient_attribute_definitions")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      internal_key: parsed.data.internalKey,
      description: parsed.data.description ?? null,
      field_type: parsed.data.fieldType,
      required: parsed.data.required,
      options: parsed.data.options,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("conflict", "An attribute with that key already exists.");
    }
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "recipient_attribute_definition_created",
    entityType: "recipient_attribute_definition",
    entityId: data.id,
    afterData: { internal_key: data.internal_key, field_type: data.field_type },
  });

  return data;
}

export async function listRecipientAttributeDefinitions(
  organizationSlug: string | undefined,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("recipient_attribute_definitions")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("name");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const setValueInputSchema = z.object({
  userId: z.uuid(),
  attributeDefinitionId: z.uuid(),
  value: z.unknown(),
});

export interface SetRecipientAttributeValueInput {
  userId: string;
  attributeDefinitionId: string;
  value: unknown;
}

/**
 * Sets (creates or updates) one user's value for a recipient attribute.
 * org_admin only — the spec attributes recipient-attribute configuration to
 * administrators throughout (spec §48.3 "Recipient attributes" is an
 * admin-only page; agent capabilities in spec §48.2 list only availability,
 * not attribute values).
 */
export async function setRecipientAttributeValue(
  organizationSlug: string | undefined,
  input: SetRecipientAttributeValueInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = setValueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the attribute value.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("recipient_attribute_values")
    .upsert(
      {
        organization_id: membership.organizationId,
        user_id: parsed.data.userId,
        attribute_definition_id: parsed.data.attributeDefinitionId,
        value: parsed.data.value,
      },
      { onConflict: "user_id,attribute_definition_id" },
    )
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "recipient_attribute_value_set",
    entityType: "recipient_attribute_value",
    entityId: data.id,
    afterData: {
      user_id: data.user_id,
      attribute_definition_id: data.attribute_definition_id,
    },
  });

  return data;
}

/**
 * Lists a user's own recipient attribute values. RLS additionally allows
 * org_admin/permitted team_manager to read another user's values, but this
 * function is the self-service entry point — a caller may only ever pass
 * their own verified id here (no `targetUserId` argument), consistent with
 * every other self-service function in this milestone.
 */
export async function listOwnRecipientAttributeValues(
  organizationSlug: string | undefined,
) {
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("recipient_attribute_values")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("user_id", user.id);

  if (error) {
    throw toAppError(error);
  }

  return data;
}
