import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireOrgAdminContext,
  requireMembershipContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

const conditionSchema = z.object({
  source: z.enum(["default_field", "custom_variable", "territory"]),
  field: z.string().optional(),
  operator: z.string(),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
});

const recipientRequirementSchema = z.object({
  attributeDefinitionId: z.uuid(),
  operator: z.enum([
    "equals",
    "not_equals",
    "is_in",
    "is_not_in",
    "is_not_empty",
    "is_empty",
  ]),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
});

const actionSchema = z.object({
  type: z.enum([
    "direct",
    "team",
    "round_robin",
    "weighted_round_robin",
    "manual_review",
  ]),
  userId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  requireTerritoryMatch: z.boolean().optional(),
});

const createRoutingRuleInputSchema = z.object({
  routingFlowId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  priority: z.number().int().min(1).default(100),
  matchType: z.enum(["match_all", "match_any"]).default("match_all"),
  conditions: z.array(conditionSchema).default([]),
  recipientRequirements: z.array(recipientRequirementSchema).default([]),
  action: actionSchema,
  stopProcessing: z.boolean().default(true),
});

export type CreateRoutingRuleInput = z.input<typeof createRoutingRuleInputSchema>;

/**
 * Creates a draft routing rule. org_admin only. Only ever edits the
 * mutable `routing_rules` working copy — a live lead is always routed
 * against a published `routing_rule_versions` snapshot instead (see
 * publishRoutingFlow), so editing rules never affects a lead already in
 * flight.
 */
export async function createRoutingRule(
  organizationSlug: string | undefined,
  input: CreateRoutingRuleInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createRoutingRuleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the routing rule details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("routing_rules")
    .insert({
      organization_id: membership.organizationId,
      routing_flow_id: parsed.data.routingFlowId,
      name: parsed.data.name,
      priority: parsed.data.priority,
      match_type: parsed.data.matchType,
      conditions: parsed.data.conditions,
      recipient_requirements: parsed.data.recipientRequirements,
      action: parsed.data.action,
      stop_processing: parsed.data.stopProcessing,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "routing_rule_created",
    entityType: "routing_rule",
    entityId: data.id,
    afterData: { name: data.name, priority: data.priority },
  });

  return data;
}

/** Lists draft routing rules for a flow, ordered by priority. */
export async function listRoutingRules(
  organizationSlug: string | undefined,
  routingFlowId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("routing_rules")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("routing_flow_id", routingFlowId)
    .order("priority");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/** Deletes a draft routing rule. org_admin only. */
export async function deleteRoutingRule(
  organizationSlug: string | undefined,
  routingRuleId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("routing_rules")
    .delete()
    .eq("id", routingRuleId)
    .eq("organization_id", membership.organizationId);

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "routing_rule_deleted",
    entityType: "routing_rule",
    entityId: routingRuleId,
  });
}
