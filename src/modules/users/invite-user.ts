import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { logger } from "@/lib/logging/logger";
import type { OrganizationRole } from "@/lib/supabase/database.types";

const inviteUserInputSchema = z.object({
  email: z.email(),
  role: z.enum(["org_admin", "team_manager", "agent"]).default("agent"),
});

export interface InviteUserInput {
  email: string;
  role?: OrganizationRole;
}

function isAlreadyRegisteredError(error: { code?: string; message: string }): boolean {
  return error.code === "email_exists" || /already registered/i.test(error.message);
}

/**
 * Invites a person to the organization (spec §10 "Invitation based
 * registration", docs/permissions-matrix.md "Invite users" — org_admin
 * only). If the email belongs to an existing Supabase Auth user (e.g. they
 * already belong to a different organization), attaches them to this
 * organization directly rather than sending a duplicate invite email — see
 * docs/decisions.md ADR-021.
 *
 * This is the first module allowed to import the service-role client
 * (docs/security-model.md §3): creating/looking up an auth.users row
 * requires the Admin API, which the publishable-key client cannot call. The
 * org_admin check above runs *before* the service-role client is ever
 * touched, and this module is on the eslint.config.mjs allow-list.
 */
export async function inviteUser(
  organizationSlug: string | undefined,
  input: InviteUserInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = inviteUserInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the invitation details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const serviceRole = createServiceRoleClient();
  const { data: inviteData, error: inviteError } =
    await serviceRole.auth.admin.inviteUserByEmail(parsed.data.email);

  let invitedUserId: string;

  if (inviteError) {
    if (!isAlreadyRegisteredError(inviteError)) {
      logger.error("user_invite_failed", {
        organization_id: membership.organizationId,
        error_code: inviteError.code ?? "unknown",
      });
      throw toAppError(inviteError);
    }

    const supabaseForLookup = await createServerSupabaseClient();
    const { data: existingUserId, error: lookupError } = await supabaseForLookup.rpc(
      "find_auth_user_id_by_email",
      { p_email: parsed.data.email },
    );

    if (lookupError || !existingUserId) {
      throw toAppError(lookupError ?? inviteError);
    }

    invitedUserId = existingUserId;
  } else {
    invitedUserId = inviteData.user.id;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("organization_users")
    .insert({
      organization_id: membership.organizationId,
      user_id: invitedUserId,
      role: parsed.data.role,
      status: "invited",
      invited_by_user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AppError(
        "conflict",
        "This person is already a member of this organization.",
      );
    }
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "user_invited",
    entityType: "organization_users",
    entityId: data.id,
    afterData: { role: data.role },
  });

  return data;
}
