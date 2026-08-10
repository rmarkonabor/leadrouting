import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireOrgAdminContext,
  requireMembershipContext,
} from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

const createRoutingFlowInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  defaultTeamId: z.uuid().optional(),
  defaultUserId: z.uuid().optional(),
  acceptanceDeadlineMinutes: z.number().int().positive().default(30),
});

export type CreateRoutingFlowInput = z.input<typeof createRoutingFlowInputSchema>;

/**
 * Creates a draft routing flow. org_admin only
 * (docs/permissions-matrix.md "Create/publish/test routing flows & rules").
 */
export async function createRoutingFlow(
  organizationSlug: string | undefined,
  input: CreateRoutingFlowInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createRoutingFlowInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the routing flow details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("routing_flows")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      default_team_id: parsed.data.defaultTeamId ?? null,
      default_user_id: parsed.data.defaultUserId ?? null,
      acceptance_deadline_minutes: parsed.data.acceptanceDeadlineMinutes,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "routing_flow_created",
    entityType: "routing_flow",
    entityId: data.id,
    afterData: { name: data.name },
  });

  return data;
}

/** Lists routing flows for the organization. Any active member may read. */
export async function listRoutingFlows(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("routing_flows")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

export async function getRoutingFlow(
  organizationSlug: string | undefined,
  routingFlowId: string,
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("routing_flows")
    .select()
    .eq("id", routingFlowId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Routing flow not found.");
  }

  return data;
}

/**
 * Publishes a routing flow: snapshots its current draft rules into an
 * immutable routing_flow_version and flips the flow to `active`, pointing
 * at that version (docs/routing-engine.md §1). org_admin only. Runs as the
 * caller (not service-role) — RLS on routing_flows/routing_rules still
 * gates who may publish.
 */
export async function publishRoutingFlow(
  organizationSlug: string | undefined,
  routingFlowId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: flow, error: flowError } = await supabase
    .from("routing_flows")
    .select()
    .eq("id", routingFlowId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (flowError || !flow) {
    throw new AppError("not_found", "Routing flow not found.");
  }

  const { data, error } = await supabase.rpc("publish_routing_flow", {
    p_routing_flow_id: routingFlowId,
  });

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "routing_flow_published",
    entityType: "routing_flow",
    entityId: routingFlowId,
    afterData: { version_number: data.version_number },
  });

  return data;
}
