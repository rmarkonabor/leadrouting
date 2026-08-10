import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";
import { HttpCrmAdapter } from "./http-crm-adapter";
import type { CrmAdapter } from "./crm-adapter";
import type { Database } from "@/lib/supabase/database.types";

const connectInputSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  settings: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.unknown()),
});

export interface ConnectIntegrationInput {
  provider: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

/** Never selects credentials_encrypted — callers only ever see connection metadata. */
const CONNECTION_SAFE_COLUMNS =
  "id, organization_id, provider, status, settings, connected_by_user_id, connected_at, created_at, updated_at";

export async function listConnections(organizationSlug: string | undefined) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("integration_connections")
    .select(CONNECTION_SAFE_COLUMNS)
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false });

  if (error) throw toAppError(error);
  return data ?? [];
}

/**
 * Connects a CRM (spec §42's `connect` + `test_connection`): encrypts the
 * provided credentials before they ever reach the database
 * (docs/decisions.md ADR-051), then verifies the connection actually works
 * before marking it `connected` — a saved-but-unverified credential would
 * silently fail every future sync instead of failing loudly now.
 *
 * `adapter` defaults to the real `HttpCrmAdapter`; tests inject
 * `TestCrmAdapter` instead (kickoff: never connect a real CRM in automated
 * tests).
 */
export async function connectIntegration(
  organizationSlug: string | undefined,
  input: ConnectIntegrationInput,
  adapter: CrmAdapter = new HttpCrmAdapter(),
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const parsed = connectInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_input", "Please check the connection details.");
  }

  await adapter.connect(parsed.data.settings, parsed.data.credentials);
  const { result } = await adapter.testConnection();
  if (!result.ok) {
    throw new AppError(
      "invalid_input",
      "Could not verify the CRM connection with these credentials.",
    );
  }

  const credentialsEncrypted = encryptSecret(JSON.stringify(parsed.data.credentials));
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        organization_id: membership.organizationId,
        provider: parsed.data.provider,
        status: "connected",
        credentials_encrypted: credentialsEncrypted,
        settings: parsed.data.settings,
        connected_by_user_id: user.id,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" },
    )
    .select(CONNECTION_SAFE_COLUMNS)
    .single();

  if (error) throw toAppError(error);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "integration_connected",
    entityType: "integration_connection",
    entityId: data.id,
  });

  return data;
}

export async function disconnectIntegration(
  organizationSlug: string | undefined,
  connectionId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("integration_connections")
    .update({ status: "disconnected", credentials_encrypted: null })
    .eq("id", connectionId)
    .eq("organization_id", membership.organizationId)
    .select(CONNECTION_SAFE_COLUMNS)
    .single();

  if (error) throw toAppError(error);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "integration_disconnected",
    entityType: "integration_connection",
    entityId: connectionId,
  });

  return data;
}

export async function testExistingConnection(
  organizationSlug: string | undefined,
  connectionId: string,
  adapterFactory: () => CrmAdapter = () => new HttpCrmAdapter(),
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data: connection, error } = await supabase
    .from("integration_connections")
    .select("id, organization_id, settings, credentials_encrypted")
    .eq("id", connectionId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (error || !connection) {
    throw new AppError("not_found", "Integration connection not found.");
  }
  if (!connection.credentials_encrypted) {
    throw new AppError("invalid_input", "This connection has no stored credentials.");
  }

  const credentials = JSON.parse(
    decryptSecret(connection.credentials_encrypted),
  ) as Record<string, unknown>;

  const adapter = adapterFactory();
  await adapter.connect(connection.settings, credentials);
  const { result } = await adapter.testConnection();

  await supabase
    .from("integration_connections")
    .update({ status: result.ok ? "connected" : "error" })
    .eq("id", connectionId);

  return result;
}

/**
 * Server-only accessor for a connection's decrypted credentials + settings
 * — used exclusively by the crm_sync consumer (service-role context), never
 * exposed through any user-facing module function above.
 */
export async function getDecryptedConnection(
  client: SupabaseClient<Database>,
  connectionId: string,
) {
  const { data, error } = await client
    .from("integration_connections")
    .select("id, organization_id, provider, settings, credentials_encrypted, status")
    .eq("id", connectionId)
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Integration connection not found.");
  }

  const credentials = data.credentials_encrypted
    ? (JSON.parse(decryptSecret(data.credentials_encrypted)) as Record<string, unknown>)
    : {};

  return { ...data, credentials };
}
