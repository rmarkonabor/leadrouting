import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and hyphens only.",
    ),
});

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

/**
 * Creates an organization and its owning org_admin membership atomically via
 * the `bootstrap_organization` database function (docs/decisions.md, this
 * is the only Milestone 1 write path for organization creation — there is
 * no direct client-side insert policy). See docs/database-schema.md §1.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const user = await getVerifiedUser();
  if (!user) {
    throw new AppError("unauthenticated", "You must be signed in.");
  }

  const parsed = createOrganizationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the organization details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("bootstrap_organization", {
    org_name: parsed.data.name,
    org_slug: parsed.data.slug,
  });

  if (error) {
    logger.error("organization_bootstrap_failed", {
      user_id: user.id,
      error_code: error.code,
    });
    throw toAppError(error);
  }

  logger.info("organization_bootstrapped", {
    organization_id: data.id,
    actor_user_id: user.id,
  });

  return data;
}
