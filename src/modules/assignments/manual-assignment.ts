import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

const manualAssignInputSchema = z.object({
  leadId: z.uuid(),
  userId: z.uuid(),
  teamId: z.uuid().optional(),
});

export type ManualAssignInput = z.input<typeof manualAssignInputSchema>;

/**
 * Administrator manual assignment (spec §35 item 8). Authorization is
 * enforced inside the `manually_assign_lead` database function itself
 * (org_admin, or a permitted team_manager when a team is specified) —
 * this wrapper only verifies the lead belongs to the caller's organization
 * before delegating, matching the pattern used by routeLead/simulateRouting.
 */
export async function manuallyAssignLead(
  organizationSlug: string | undefined,
  input: ManualAssignInput,
) {
  return callManualAssignmentRpc(organizationSlug, input, "manually_assign_lead");
}

/** Administrator manual reassignment (spec §35 item 9). Same authorization model. */
export async function manuallyReassignLead(
  organizationSlug: string | undefined,
  input: ManualAssignInput,
) {
  return callManualAssignmentRpc(organizationSlug, input, "manually_reassign_lead");
}

async function callManualAssignmentRpc(
  organizationSlug: string | undefined,
  input: ManualAssignInput,
  rpcName: "manually_assign_lead" | "manually_reassign_lead",
) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const parsed = manualAssignInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the assignment details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", parsed.data.leadId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (leadError || !lead) {
    throw new AppError("not_found", "Lead not found.");
  }

  const { data, error } = await supabase.rpc(rpcName, {
    p_lead_id: parsed.data.leadId,
    p_user_id: parsed.data.userId,
    p_team_id: parsed.data.teamId ?? null,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
