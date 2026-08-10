import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { buildSyncContactPayload, type SyncContactPayload } from "./sync-payload";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";
import type { SafeRequestSummary, SafeResponseSummary } from "./redact";

export interface ConnectedConnection {
  id: string;
  provider: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface WriteLogParams {
  organizationId: string;
  integrationJobId: string;
  provider: string;
  eventType: string;
  leadId: string | null;
  status: "completed" | "failed";
  requestSummary?: SafeRequestSummary;
  responseSummary?: SafeResponseSummary;
}

/**
 * Every database operation `processCrmSyncBatch` needs, behind one narrow
 * interface — the same "consumer never touches a raw client directly"
 * shape as Milestone 6's `NotificationContentResolver`/`NotificationRecorder`.
 * This is what makes the duplicate-CRM-record regression test (retrying a
 * `sync_contact` job must never create a second `external_record_links`
 * row) meaningfully unit-testable without a live PostgREST server —
 * `TestCrmSyncRepository` enforces the same uniqueness invariant in memory
 * that the real `external_record_links` unique constraints enforce in
 * Postgres.
 */
export interface CrmSyncRepository {
  getLeadOrganizationId(leadId: string): Promise<string | null>;
  getConnectedConnections(organizationId: string): Promise<ConnectedConnection[]>;
  buildSyncContactPayload(
    connectionId: string,
    leadId: string,
  ): Promise<SyncContactPayload>;
  upsertExternalRecordLink(params: {
    organizationId: string;
    connectionId: string;
    leadId: string;
    provider: string;
    externalRecordId: string;
  }): Promise<void>;
  getExternalRecordId(connectionId: string, leadId: string): Promise<string | null>;
  writeLog(params: WriteLogParams): Promise<void>;
  updateConnectionCredentials(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<void>;
}

export class SupabaseCrmSyncRepository implements CrmSyncRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getLeadOrganizationId(leadId: string): Promise<string | null> {
    const { data } = await this.client
      .from("leads")
      .select("organization_id")
      .eq("id", leadId)
      .single();
    return data?.organization_id ?? null;
  }

  async getConnectedConnections(organizationId: string): Promise<ConnectedConnection[]> {
    const { data, error } = await this.client
      .from("integration_connections")
      .select("id, provider, settings, credentials_encrypted")
      .eq("organization_id", organizationId)
      .eq("status", "connected");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      settings: row.settings,
      credentials: row.credentials_encrypted
        ? (JSON.parse(decryptSecret(row.credentials_encrypted)) as Record<
            string,
            unknown
          >)
        : {},
    }));
  }

  async buildSyncContactPayload(
    connectionId: string,
    leadId: string,
  ): Promise<SyncContactPayload> {
    return buildSyncContactPayload(this.client, connectionId, leadId);
  }

  async upsertExternalRecordLink(params: {
    organizationId: string;
    connectionId: string;
    leadId: string;
    provider: string;
    externalRecordId: string;
  }): Promise<void> {
    await this.client.from("external_record_links").upsert(
      {
        organization_id: params.organizationId,
        integration_connection_id: params.connectionId,
        lead_id: params.leadId,
        provider: params.provider,
        external_record_id: params.externalRecordId,
      },
      { onConflict: "integration_connection_id,lead_id" },
    );
  }

  async getExternalRecordId(
    connectionId: string,
    leadId: string,
  ): Promise<string | null> {
    const { data } = await this.client
      .from("external_record_links")
      .select("external_record_id")
      .eq("integration_connection_id", connectionId)
      .eq("lead_id", leadId)
      .maybeSingle();
    return data?.external_record_id ?? null;
  }

  async writeLog(params: WriteLogParams): Promise<void> {
    await this.client.from("integration_logs").upsert(
      {
        organization_id: params.organizationId,
        integration_job_id: params.integrationJobId,
        provider: params.provider,
        event_type: params.eventType,
        lead_id: params.leadId,
        request_summary:
          (params.requestSummary as unknown as Record<string, unknown>) ?? null,
        response_summary:
          (params.responseSummary as unknown as Record<string, unknown>) ?? null,
        status: params.status,
        attempt_count: 1,
        completed_at: params.status === "completed" ? new Date().toISOString() : null,
      },
      { onConflict: "integration_job_id" },
    );
  }

  async updateConnectionCredentials(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    await this.client
      .from("integration_connections")
      .update({ credentials_encrypted: encryptSecret(JSON.stringify(credentials)) })
      .eq("id", connectionId);
  }
}

export class TestCrmSyncRepository implements CrmSyncRepository {
  leadOrganizationIds = new Map<string, string>();
  connectionsByOrg = new Map<string, ConnectedConnection[]>();
  payloadsByConnectionAndLead = new Map<string, SyncContactPayload>();
  readonly externalRecordLinks = new Map<string, string>(); // key: `${connectionId}:${leadId}` -> externalRecordId
  readonly externalRecordIdsUsed = new Set<string>(); // key: `${connectionId}:${externalRecordId}` — enforces provider+org uniqueness like the real constraint
  readonly logs: WriteLogParams[] = [];
  readonly credentialUpdates: Array<{
    connectionId: string;
    credentials: Record<string, unknown>;
  }> = [];

  async getLeadOrganizationId(leadId: string): Promise<string | null> {
    await Promise.resolve();
    return this.leadOrganizationIds.get(leadId) ?? null;
  }

  async getConnectedConnections(organizationId: string): Promise<ConnectedConnection[]> {
    await Promise.resolve();
    return this.connectionsByOrg.get(organizationId) ?? [];
  }

  async buildSyncContactPayload(
    connectionId: string,
    leadId: string,
  ): Promise<SyncContactPayload> {
    await Promise.resolve();
    const payload = this.payloadsByConnectionAndLead.get(`${connectionId}:${leadId}`);
    if (!payload) throw new Error(`No fixture payload for ${connectionId}:${leadId}`);
    // Mirrors the real implementation resolving fresh at dispatch time: if a
    // link already exists (e.g. from a prior attempt), the next attempt's
    // contact carries that externalRecordId so the CRM call is an update,
    // not a second create.
    const existingExternalRecordId = this.externalRecordLinks.get(
      `${connectionId}:${leadId}`,
    );
    return existingExternalRecordId
      ? {
          ...payload,
          contact: { ...payload.contact, externalRecordId: existingExternalRecordId },
        }
      : payload;
  }

  async upsertExternalRecordLink(params: {
    organizationId: string;
    connectionId: string;
    leadId: string;
    provider: string;
    externalRecordId: string;
  }): Promise<void> {
    await Promise.resolve();
    const linkKey = `${params.connectionId}:${params.leadId}`;
    const existing = this.externalRecordLinks.get(linkKey);
    // Mirrors external_record_links_connection_lead_unique: retrying the
    // same lead+connection always upserts the same row, never a second one.
    if (existing) {
      this.externalRecordIdsUsed.delete(`${params.connectionId}:${existing}`);
    }
    this.externalRecordLinks.set(linkKey, params.externalRecordId);
    this.externalRecordIdsUsed.add(`${params.connectionId}:${params.externalRecordId}`);
  }

  async getExternalRecordId(
    connectionId: string,
    leadId: string,
  ): Promise<string | null> {
    await Promise.resolve();
    return this.externalRecordLinks.get(`${connectionId}:${leadId}`) ?? null;
  }

  async writeLog(params: WriteLogParams): Promise<void> {
    this.logs.push(params);
    await Promise.resolve();
  }

  async updateConnectionCredentials(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    this.credentialUpdates.push({ connectionId, credentials });
    await Promise.resolve();
  }
}
