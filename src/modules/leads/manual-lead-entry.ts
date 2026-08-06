import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { isOrgAdmin } from "@/lib/permissions/roles";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

const manualLeadInputSchema = z.object({
  firstName: z.string().trim().max(200).optional(),
  lastName: z.string().trim().max(200).optional(),
  email: z.email().optional(),
  phone: z.string().trim().max(50).optional(),
  streetAddress: z.string().trim().max(500).optional(),
  unitNumber: z.string().trim().max(50).optional(),
  neighborhood: z.string().trim().max(200).optional(),
  city: z.string().trim().max(200).optional(),
  county: z.string().trim().max(200).optional(),
  stateProvince: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(50).optional(),
  country: z.string().trim().max(200).optional(),
  message: z.string().trim().max(5000).optional(),
});

export interface ManualLeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  streetAddress?: string;
  unitNumber?: string;
  neighborhood?: string;
  city?: string;
  county?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  message?: string;
}

/**
 * Creates a lead directly from the authenticated app (spec §17's "manual"
 * source type), bypassing the token-based intake endpoint entirely — the
 * caller already has a verified session. org_admin or a team_manager
 * permitted for at least one team may create leads manually
 * (docs/permissions-matrix.md "Manually assign / reassign a lead" is the
 * closest analogue; an agent cannot). No field mapping/duplicate detection
 * runs on this path — it is not an external, untrusted submission.
 */
export async function createManualLead(
  organizationSlug: string | undefined,
  input: ManualLeadInput,
) {
  const { user, membership } = await requireMembershipContext(organizationSlug);

  const parsed = manualLeadInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the lead details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();

  if (!isOrgAdmin(membership.role)) {
    const { data: managedTeam } = await supabase
      .from("team_users")
      .select("id")
      .eq("organization_id", membership.organizationId)
      .eq("user_id", user.id)
      .eq("is_manager", true)
      .limit(1)
      .maybeSingle();

    if (!managedTeam) {
      throw new AppError(
        "forbidden",
        "Only an organization administrator or a team manager may create leads manually.",
      );
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: membership.organizationId,
      first_name: parsed.data.firstName ?? null,
      last_name: parsed.data.lastName ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      street_address: parsed.data.streetAddress ?? null,
      unit_number: parsed.data.unitNumber ?? null,
      neighborhood: parsed.data.neighborhood ?? null,
      city: parsed.data.city ?? null,
      county: parsed.data.county ?? null,
      state_province: parsed.data.stateProvince ?? null,
      postal_code: parsed.data.postalCode ?? null,
      country: parsed.data.country ?? null,
      message: parsed.data.message ?? null,
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "lead_created_manually",
    entityType: "lead",
    entityId: data.id,
  });

  return data;
}

/**
 * Lists leads visible to the caller, scoped by leads_select_scoped RLS
 * (org_admin: all; team_manager: leads assigned to permitted teams; agent:
 * own assigned leads). With no routing yet, non-admin callers will
 * typically see zero rows.
 */
export async function listLeads(organizationSlug: string | undefined) {
  const { membership } = await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw toAppError(error);
  }

  return data;
}
