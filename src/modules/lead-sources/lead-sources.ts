import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import type { LeadSourceType } from "@/lib/supabase/database.types";

/**
 * Hashes a plaintext source token with sha256, matching the format the
 * `resolve_lead_source`/`record_lead_submission` Postgres functions compare
 * against (docs/decisions.md ADR-011). Hashing happens here, in
 * TypeScript, rather than inside Postgres, so the plaintext token never has
 * to round-trip through a second hashing implementation to stay consistent.
 */
export function hashSourceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateSourceToken(): string {
  return `lrt_${randomBytes(32).toString("hex")}`;
}

const createLeadSourceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sourceType: z.enum(["api", "webhook", "external_form", "manual", "csv", "crm"]),
  rateLimitSettings: z
    .object({
      windowSeconds: z.number().int().positive(),
      maxRequests: z.number().int().positive(),
    })
    .optional(),
  signatureSettings: z
    .object({ enabled: z.boolean(), signingSecret: z.string().min(16).optional() })
    .optional(),
});

export interface CreateLeadSourceInput {
  name: string;
  sourceType: LeadSourceType;
  rateLimitSettings?: { windowSeconds: number; maxRequests: number };
  signatureSettings?: { enabled: boolean; signingSecret?: string };
}

/**
 * Creates a lead source and issues its first token. The plaintext token is
 * returned exactly once — only its hash is ever persisted
 * (docs/security-model.md §3). org_admin only
 * (docs/permissions-matrix.md "Create/update lead sources & tokens").
 */
export async function createLeadSource(
  organizationSlug: string | undefined,
  input: CreateLeadSourceInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createLeadSourceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the lead source details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const plaintextToken = generateSourceToken();
  const tokenHash = hashSourceToken(plaintextToken);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("lead_sources")
    .insert({
      organization_id: membership.organizationId,
      name: parsed.data.name,
      source_type: parsed.data.sourceType,
      source_token_hash: tokenHash,
      ...(parsed.data.rateLimitSettings
        ? { rate_limit_settings: parsed.data.rateLimitSettings }
        : {}),
      ...(parsed.data.signatureSettings
        ? { signature_settings: parsed.data.signatureSettings }
        : {}),
    })
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  const { error: tokenError } = await supabase.from("api_tokens").insert({
    organization_id: membership.organizationId,
    lead_source_id: data.id,
    token_hash: tokenHash,
  });

  if (tokenError) {
    throw toAppError(tokenError);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "lead_source_created",
    entityType: "lead_source",
    entityId: data.id,
    afterData: { name: data.name, source_type: data.source_type },
  });

  return { leadSource: data, plaintextToken };
}

/**
 * Rotates a lead source's token: issues a new plaintext token, updates
 * `source_token_hash`, and records the rotation in `api_tokens`. The
 * previous token stops resolving immediately (there is no grace period in
 * this milestone). org_admin only.
 */
export async function rotateLeadSourceToken(
  organizationSlug: string | undefined,
  leadSourceId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("lead_sources")
    .select()
    .eq("id", leadSourceId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (existingError || !existing) {
    throw new AppError("not_found", "Lead source not found.");
  }

  const plaintextToken = generateSourceToken();
  const tokenHash = hashSourceToken(plaintextToken);

  const { data, error } = await supabase
    .from("lead_sources")
    .update({ source_token_hash: tokenHash })
    .eq("id", leadSourceId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  const { error: tokenError } = await supabase.from("api_tokens").insert({
    organization_id: membership.organizationId,
    lead_source_id: leadSourceId,
    token_hash: tokenHash,
  });

  if (tokenError) {
    throw toAppError(tokenError);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "lead_source_token_rotated",
    entityType: "lead_source",
    entityId: leadSourceId,
  });

  return { leadSource: data, plaintextToken };
}

/**
 * Lists lead sources visible to the caller's organization. org_admin only —
 * lead sources carry token settings, not something any active member should
 * see (docs/permissions-matrix.md).
 */
export async function listLeadSources(organizationSlug: string | undefined) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("lead_sources")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at");

  if (error) {
    throw toAppError(error);
  }

  return data;
}

const updateLeadSourceInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  rateLimitSettings: z
    .object({
      windowSeconds: z.number().int().positive(),
      maxRequests: z.number().int().positive(),
    })
    .optional(),
  signatureSettings: z
    .object({ enabled: z.boolean(), signingSecret: z.string().min(16).optional() })
    .optional(),
});

export interface UpdateLeadSourceInput {
  name?: string;
  status?: "active" | "inactive";
  rateLimitSettings?: { windowSeconds: number; maxRequests: number };
  signatureSettings?: { enabled: boolean; signingSecret?: string };
}

/**
 * Updates a lead source's name/status/rate-limit/signature settings.
 * org_admin only.
 */
export async function updateLeadSource(
  organizationSlug: string | undefined,
  leadSourceId: string,
  input: UpdateLeadSourceInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = updateLeadSourceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the lead source details.", {
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const supabase = await createServerSupabaseClient();
  const update: {
    name?: string;
    status?: "active" | "inactive";
    rate_limit_settings?: Record<string, unknown>;
    signature_settings?: Record<string, unknown>;
  } = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.rateLimitSettings !== undefined) {
    update.rate_limit_settings = parsed.data.rateLimitSettings;
  }
  if (parsed.data.signatureSettings !== undefined) {
    update.signature_settings = parsed.data.signatureSettings;
  }

  const { data, error } = await supabase
    .from("lead_sources")
    .update(update)
    .eq("id", leadSourceId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "lead_source_updated",
    entityType: "lead_source",
    entityId: data.id,
    afterData: update,
  });

  return data;
}

/**
 * Reads a single lead source. org_admin only, matching the
 * lead_sources_all_org_admin RLS policy.
 */
export async function getLeadSource(
  organizationSlug: string | undefined,
  leadSourceId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("lead_sources")
    .select()
    .eq("id", leadSourceId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Lead source not found.");
  }

  return data;
}
