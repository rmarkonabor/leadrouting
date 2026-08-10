"use server";

import { revalidatePath } from "next/cache";
import { createRoutingFlow } from "./routing-flows";
import { createRoutingRule, deleteRoutingRule } from "./routing-rules";
import { publishRoutingFlow } from "./routing-flows";
import { simulateRouting } from "./simulate-routing";
import {
  formatRoutingExplanation,
  type RoutingExplanationLike,
} from "./format-explanation";
import { toAppError } from "@/lib/errors/app-error";

export interface CreateRoutingFlowFormState {
  error?: string;
}

export async function createRoutingFlowFormAction(
  organizationSlug: string,
  _prevState: CreateRoutingFlowFormState,
  formData: FormData,
): Promise<CreateRoutingFlowFormState> {
  try {
    await createRoutingFlow(organizationSlug, {
      name: String(formData.get("name") ?? ""),
      acceptanceDeadlineMinutes: Number(formData.get("acceptanceDeadlineMinutes") ?? 30),
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/routing`);
  return {};
}

export interface CreateRoutingRuleFormState {
  error?: string;
}

/**
 * Minimal rule builder: a single top-level condition (or none, for an
 * unconditional rule) plus one action. A richer multi-condition/multi-group
 * builder is a natural follow-up, not required by this milestone's scope.
 */
export async function createRoutingRuleFormAction(
  organizationSlug: string,
  routingFlowId: string,
  _prevState: CreateRoutingRuleFormState,
  formData: FormData,
): Promise<CreateRoutingRuleFormState> {
  const field = String(formData.get("conditionField") ?? "").trim();
  const value = String(formData.get("conditionValue") ?? "").trim();
  const conditions =
    field && value
      ? [{ source: "default_field" as const, field, operator: "equals", value }]
      : [];

  const actionType = String(formData.get("actionType") ?? "manual_review") as
    "direct" | "round_robin" | "weighted_round_robin" | "manual_review";
  const teamId = String(formData.get("teamId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();

  try {
    await createRoutingRule(organizationSlug, {
      routingFlowId,
      name: String(formData.get("name") ?? ""),
      priority: Number(formData.get("priority") ?? 100),
      matchType: "match_all",
      conditions,
      action: {
        type: actionType,
        ...(teamId ? { teamId } : {}),
        ...(userId ? { userId } : {}),
      },
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/org/${organizationSlug}/routing/${routingFlowId}`);
  return {};
}

export async function deleteRoutingRuleAction(
  organizationSlug: string,
  routingFlowId: string,
  routingRuleId: string,
) {
  await deleteRoutingRule(organizationSlug, routingRuleId);
  revalidatePath(`/org/${organizationSlug}/routing/${routingFlowId}`);
}

export interface PublishRoutingFlowFormState {
  error?: string;
  versionNumber?: number;
}

export async function publishRoutingFlowFormAction(
  organizationSlug: string,
  routingFlowId: string,
  _prevState: PublishRoutingFlowFormState,
  _formData: FormData,
): Promise<PublishRoutingFlowFormState> {
  try {
    const version = await publishRoutingFlow(organizationSlug, routingFlowId);
    revalidatePath(`/org/${organizationSlug}/routing/${routingFlowId}`);
    return { versionNumber: version.version_number };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface SimulateRoutingFormState {
  error?: string;
  explanation?: string;
  raw?: unknown;
}

/**
 * Runs the read-only simulator against an existing lead and renders its
 * structured result via formatRoutingExplanation — the same deterministic
 * renderer a live assignment's explanation would use, so simulator and
 * live output are visibly consistent to an admin (spec §33/§34).
 */
export async function simulateRoutingFormAction(
  organizationSlug: string,
  _prevState: SimulateRoutingFormState,
  formData: FormData,
): Promise<SimulateRoutingFormState> {
  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!leadId) {
    return { error: "Enter a lead ID to simulate." };
  }

  try {
    const result = await simulateRouting(organizationSlug, leadId);
    return {
      explanation: formatRoutingExplanation(result as unknown as RoutingExplanationLike),
      raw: result,
    };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
