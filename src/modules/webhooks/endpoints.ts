import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { encryptSecret, generateWebhookSecret } from "@/lib/crypto/secret-box";
import type { WebhookEventType } from "@/lib/supabase/database.types";

const WEBHOOK_EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "lead.accepted",
  "lead.declined",
  "lead.reassigned",
  "lead.status_changed",
  "lead.converted",
  "lead.lost",
] as const satisfies readonly WebhookEventType[];

const createEndpointInputSchema = z.object({
  url: z.url(),
  subscribedEvents: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
});

export interface CreateWebhookEndpointInput {
  url: string;
  subscribedEvents: WebhookEventType[];
}

/** Never selects secret_encrypted — callers only ever see endpoint metadata. */
const ENDPOINT_SAFE_COLUMNS =
  "id, organization_id, url, subscribed_events, status, created_at, updated_at";

export async function listWebhookEndpoints(organizationSlug: string | undefined) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select(ENDPOINT_SAFE_COLUMNS)
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (error) throw toAppError(error);
  return data ?? [];
}

/**
 * Creates a webhook endpoint and generates its signing secret. The
 * plaintext secret is returned exactly once — only its encrypted form is
 * persisted (same one-time-reveal pattern as lead_sources' token issuance).
 */
export async function createWebhookEndpoint(
  organizationSlug: string | undefined,
  input: CreateWebhookEndpointInput,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = createEndpointInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the webhook endpoint details.");
  }

  const secret = generateWebhookSecret();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      organization_id: membership.organizationId,
      url: parsed.data.url,
      secret_encrypted: encryptSecret(secret),
      subscribed_events: parsed.data.subscribedEvents,
    })
    .select(ENDPOINT_SAFE_COLUMNS)
    .single();

  if (error) throw toAppError(error);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "webhook_endpoint_created",
    entityType: "webhook_endpoint",
    entityId: data.id,
  });

  return { endpoint: data, secret };
}

/** Secret rotation (spec §43 requirement 8) — the old secret stops verifying immediately. */
export async function rotateWebhookSecret(
  organizationSlug: string | undefined,
  endpointId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);
  const secret = generateWebhookSecret();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update({ secret_encrypted: encryptSecret(secret) })
    .eq("id", endpointId)
    .eq("organization_id", membership.organizationId)
    .select(ENDPOINT_SAFE_COLUMNS)
    .single();

  if (error) throw toAppError(error);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "webhook_secret_rotated",
    entityType: "webhook_endpoint",
    entityId: endpointId,
  });

  return { endpoint: data, secret };
}

export async function updateWebhookEndpointStatus(
  organizationSlug: string | undefined,
  endpointId: string,
  status: "active" | "inactive",
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update({ status })
    .eq("id", endpointId)
    .eq("organization_id", membership.organizationId)
    .select(ENDPOINT_SAFE_COLUMNS)
    .single();

  if (error) throw toAppError(error);
  return data;
}

export async function deleteWebhookEndpoint(
  organizationSlug: string | undefined,
  endpointId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("id", endpointId)
    .eq("organization_id", membership.organizationId);

  if (error) throw toAppError(error);
}
