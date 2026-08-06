import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireOrgAdminContext,
  requireMembershipContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type { AttributeFieldType } from "@/lib/supabase/database.types";

const createCustomVariableInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  internalKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only."),
  description: z.string().trim().max(2000).optional(),
  fieldType: z.enum([
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
  ]),
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(z.unknown()).default([]),
  validationRules: z.record(z.string(), z.unknown()).default({}),
});

export interface CreateCustomVariableInput {
  name: string;
  internalKey: string;
  description?: string;
  fieldType: AttributeFieldType;
  required?: boolean;
  defaultValue?: unknown;
  options?: unknown[];
  validationRules?: Record<string, unknown>;
}

/**
 * Creates a custom lead variable definition. org_admin only
 * (docs/permissions-matrix.md "Create/update custom lead variables").
 */
export async function createCustomVariableDefinition(
  organizationSlug: string | undefined,
  input: CreateCustomVariableInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createCustomVariableInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the custom variable details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("custom_variable_definitions")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      internal_key: parsed.data.internalKey,
      description: parsed.data.description ?? null,
      field_type: parsed.data.fieldType,
      required: parsed.data.required,
      default_value: parsed.data.defaultValue ?? null,
      options: parsed.data.options,
      validation_rules: parsed.data.validationRules,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "custom_variable_created",
    entityType: "custom_variable_definition",
    entityId: data.id,
    afterData: { name: data.name, internal_key: data.internal_key },
  });

  return data;
}

/**
 * Lists custom variable definitions. Any active org member may read
 * (needed to render a lead's custom values, per docs/database-schema.md §6).
 */
export async function listCustomVariableDefinitions(
  organizationSlug: string | undefined,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("custom_variable_definitions")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("name");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const updateCustomVariableInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.unknown()).optional(),
  validationRules: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

export interface UpdateCustomVariableInput {
  name?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: unknown[];
  validationRules?: Record<string, unknown>;
  active?: boolean;
}

/**
 * Updates a custom variable definition. org_admin only.
 */
export async function updateCustomVariableDefinition(
  organizationSlug: string | undefined,
  definitionId: string,
  input: UpdateCustomVariableInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = updateCustomVariableInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the custom variable details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const update: {
    name?: string;
    description?: string | null;
    required?: boolean;
    default_value?: unknown;
    options?: unknown[];
    validation_rules?: Record<string, unknown>;
    active?: boolean;
  } = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.required !== undefined) update.required = parsed.data.required;
  if (parsed.data.defaultValue !== undefined)
    update.default_value = parsed.data.defaultValue;
  if (parsed.data.options !== undefined) update.options = parsed.data.options;
  if (parsed.data.validationRules !== undefined)
    update.validation_rules = parsed.data.validationRules;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("custom_variable_definitions")
    .update(update)
    .eq("id", definitionId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "custom_variable_updated",
    entityType: "custom_variable_definition",
    entityId: data.id,
    afterData: update,
  });

  return data;
}
