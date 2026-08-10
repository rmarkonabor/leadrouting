import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WebhookEventType } from "@/lib/supabase/database.types";
import {
  buildWebhookEventPayload,
  type WebhookEventPayload,
} from "./build-event-payload";
import { decryptSecret } from "@/lib/crypto/secret-box";

export interface SubscribedEndpoint {
  id: string;
  url: string;
  secret: string;
}

/**
 * Every database operation `processOutboundWebhookBatch` needs, behind one
 * narrow interface — same rationale as `CrmSyncRepository`: makes the
 * consumer's replay-protection/idempotent-delivery behavior unit-testable
 * with an in-memory double instead of a live PostgREST server.
 */
export interface WebhookRepository {
  getLeadOrganizationId(leadId: string): Promise<string | null>;
  getSubscribedEndpoints(
    organizationId: string,
    eventType: string,
  ): Promise<SubscribedEndpoint[]>;
  buildEventPayload(
    eventId: string,
    eventType: string,
    organizationId: string,
    jobPayload: Record<string, unknown>,
  ): Promise<WebhookEventPayload>;
  isAlreadyDelivered(endpointId: string, eventId: string): Promise<boolean>;
  recordDelivery(params: {
    organizationId: string;
    endpointId: string;
    integrationJobId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    delivered: boolean;
    responseStatus: number;
  }): Promise<void>;
}

export class SupabaseWebhookRepository implements WebhookRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getLeadOrganizationId(leadId: string): Promise<string | null> {
    const { data } = await this.client
      .from("leads")
      .select("organization_id")
      .eq("id", leadId)
      .single();
    return data?.organization_id ?? null;
  }

  async getSubscribedEndpoints(
    organizationId: string,
    eventType: string,
  ): Promise<SubscribedEndpoint[]> {
    const { data, error } = await this.client
      .from("webhook_endpoints")
      .select("id, url, secret_encrypted")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .contains("subscribed_events", [eventType as WebhookEventType]);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      url: row.url,
      secret: decryptSecret(row.secret_encrypted),
    }));
  }

  async buildEventPayload(
    eventId: string,
    eventType: string,
    organizationId: string,
    jobPayload: Record<string, unknown>,
  ): Promise<WebhookEventPayload> {
    return buildWebhookEventPayload(
      this.client,
      eventId,
      eventType,
      organizationId,
      jobPayload,
    );
  }

  async isAlreadyDelivered(endpointId: string, eventId: string): Promise<boolean> {
    const { data } = await this.client
      .from("webhook_deliveries")
      .select("status")
      .eq("webhook_endpoint_id", endpointId)
      .eq("event_id", eventId)
      .maybeSingle();
    return data?.status === "delivered";
  }

  async recordDelivery(params: {
    organizationId: string;
    endpointId: string;
    integrationJobId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    delivered: boolean;
    responseStatus: number;
  }): Promise<void> {
    await this.client.from("webhook_deliveries").upsert(
      {
        organization_id: params.organizationId,
        webhook_endpoint_id: params.endpointId,
        integration_job_id: params.integrationJobId,
        event_id: params.eventId,
        event_type: params.eventType,
        payload: params.payload,
        status: params.delivered ? "delivered" : "failed",
        attempt_count: 1,
        last_response_status: params.responseStatus,
        completed_at: params.delivered ? new Date().toISOString() : null,
      },
      { onConflict: "webhook_endpoint_id,event_id" },
    );
  }
}

export class TestWebhookRepository implements WebhookRepository {
  leadOrganizationIds = new Map<string, string>();
  endpointsByOrgAndEvent = new Map<string, SubscribedEndpoint[]>();
  payloadsByEventId = new Map<string, WebhookEventPayload>();
  readonly deliveredEvents = new Set<string>(); // key: `${endpointId}:${eventId}`
  readonly deliveries: Array<{
    organizationId: string;
    endpointId: string;
    integrationJobId: string;
    eventId: string;
    eventType: string;
    delivered: boolean;
    responseStatus: number;
  }> = [];

  async getLeadOrganizationId(leadId: string): Promise<string | null> {
    await Promise.resolve();
    return this.leadOrganizationIds.get(leadId) ?? null;
  }

  async getSubscribedEndpoints(
    organizationId: string,
    eventType: string,
  ): Promise<SubscribedEndpoint[]> {
    await Promise.resolve();
    return this.endpointsByOrgAndEvent.get(`${organizationId}:${eventType}`) ?? [];
  }

  async buildEventPayload(eventId: string): Promise<WebhookEventPayload> {
    await Promise.resolve();
    const payload = this.payloadsByEventId.get(eventId);
    if (!payload) throw new Error(`No fixture payload for event ${eventId}`);
    return payload;
  }

  async isAlreadyDelivered(endpointId: string, eventId: string): Promise<boolean> {
    await Promise.resolve();
    return this.deliveredEvents.has(`${endpointId}:${eventId}`);
  }

  async recordDelivery(params: {
    organizationId: string;
    endpointId: string;
    integrationJobId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    delivered: boolean;
    responseStatus: number;
  }): Promise<void> {
    this.deliveries.push(params);
    // Mirrors webhook_deliveries_endpoint_event_unique: the same
    // (endpoint, event) key always upserts, so a redelivered/duplicate job
    // never records two "delivered" rows for the same logical event.
    if (params.delivered) {
      this.deliveredEvents.add(`${params.endpointId}:${params.eventId}`);
    }
    await Promise.resolve();
  }
}
