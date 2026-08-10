import type { SafeRequestSummary, SafeResponseSummary } from "./redact";

/**
 * Generic CRM adapter interface (spec §42) — built before any provider-
 * specific code, per the kickoff's explicit instruction. One concrete
 * implementation (`HttpCrmAdapter`) satisfies "Phase 1 should implement one
 * direct CRM adapter": a generic, settings-configured OAuth2 + REST
 * adapter rather than a named vendor's API, since no specific CRM is named
 * anywhere in the spec or the kickoff and this codebase has no verified
 * documentation for any one vendor's exact endpoints (docs/decisions.md
 * ADR-053). Real automated tests use `TestCrmAdapter` exclusively — the
 * kickoff explicitly forbids connecting a real production CRM during
 * automated testing.
 */

export interface CrmCredentials {
  [key: string]: unknown;
}

export interface CrmConnectionSettings {
  [key: string]: unknown;
}

export interface CrmContactInput {
  /** Set when updating a contact this connection has already linked (external_record_links). */
  externalRecordId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** Mapped default/custom fields, keyed by the CRM-side field name (integration_field_mappings.crm_field). */
  fields: Record<string, unknown>;
}

export interface CrmContactResult {
  externalRecordId: string;
}

export interface CrmUser {
  externalId: string;
  name: string;
  email?: string;
}

export interface CrmWebhookRequest {
  headers: Record<string, string>;
  rawBody: string;
}

/** A status change or similar event the CRM is pushing back to us (spec §42 item 7). */
export interface CrmWebhookEvent {
  externalRecordId: string;
  /** The CRM's own status/stage value — mapped to a lead_status key by the caller. */
  crmStatus: string;
}

export interface CrmAdapterCallResult<T> {
  result: T;
  requestSummary: SafeRequestSummary;
  responseSummary: SafeResponseSummary;
}

export interface CrmAdapter {
  connect(settings: CrmConnectionSettings, credentials: CrmCredentials): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<CrmAdapterCallResult<{ ok: boolean }>>;
  listUsers(): Promise<CrmAdapterCallResult<CrmUser[]>>;
  createOrUpdateContact(
    contact: CrmContactInput,
  ): Promise<CrmAdapterCallResult<CrmContactResult>>;
  assignOwner(
    externalRecordId: string,
    ownerExternalId: string,
  ): Promise<CrmAdapterCallResult<void>>;
  updateStatus(
    externalRecordId: string,
    status: string,
  ): Promise<CrmAdapterCallResult<void>>;
  createNote(externalRecordId: string, note: string): Promise<CrmAdapterCallResult<void>>;
  handleWebhook(request: CrmWebhookRequest): Promise<CrmWebhookEvent | null>;
  /** Returns refreshed credentials to persist, or null if nothing changed. */
  refreshCredentials(): Promise<CrmCredentials | null>;
}
