import type {
  CrmAdapter,
  CrmAdapterCallResult,
  CrmConnectionSettings,
  CrmContactInput,
  CrmContactResult,
  CrmCredentials,
  CrmUser,
  CrmWebhookEvent,
  CrmWebhookRequest,
} from "./crm-adapter";
import { buildSafeRequestSummary, buildSafeResponseSummary } from "./redact";

/**
 * In-memory CRM double — every automated test uses this, never a real
 * network call (kickoff requirement: "Do not connect a real production CRM
 * during automated testing"). Records every call so tests can assert on
 * ownership mapping, custom-variable mapping, and duplicate-prevention
 * behavior without a live CRM.
 */
export class TestCrmAdapter implements CrmAdapter {
  connected = false;
  settings: CrmConnectionSettings | null = null;
  credentials: CrmCredentials | null = null;
  readonly contacts = new Map<string, CrmContactInput>();
  readonly ownerAssignments: Array<{
    externalRecordId: string;
    ownerExternalId: string;
  }> = [];
  readonly statusUpdates: Array<{ externalRecordId: string; status: string }> = [];
  readonly notes: Array<{ externalRecordId: string; note: string }> = [];
  users: CrmUser[] = [];
  nextExternalId = 1;
  testConnectionResult = true;
  refreshedCredentials: CrmCredentials | null = null;

  async connect(
    settings: CrmConnectionSettings,
    credentials: CrmCredentials,
  ): Promise<void> {
    this.settings = settings;
    this.credentials = credentials;
    this.connected = true;
    await Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await Promise.resolve();
  }

  async testConnection(): Promise<CrmAdapterCallResult<{ ok: boolean }>> {
    await Promise.resolve();
    return {
      result: { ok: this.testConnectionResult },
      requestSummary: buildSafeRequestSummary("GET", "test://crm/ping"),
      responseSummary: buildSafeResponseSummary(
        this.testConnectionResult ? 200 : 401,
        this.testConnectionResult,
      ),
    };
  }

  async listUsers(): Promise<CrmAdapterCallResult<CrmUser[]>> {
    await Promise.resolve();
    return {
      result: this.users,
      requestSummary: buildSafeRequestSummary("GET", "test://crm/users"),
      responseSummary: buildSafeResponseSummary(200, true),
    };
  }

  async createOrUpdateContact(
    contact: CrmContactInput,
  ): Promise<CrmAdapterCallResult<CrmContactResult>> {
    const externalRecordId =
      contact.externalRecordId ?? `crm-contact-${this.nextExternalId++}`;
    this.contacts.set(externalRecordId, contact);
    await Promise.resolve();
    return {
      result: { externalRecordId },
      requestSummary: buildSafeRequestSummary(
        contact.externalRecordId ? "PATCH" : "POST",
        "test://crm/contacts",
        contact.fields,
      ),
      responseSummary: buildSafeResponseSummary(
        contact.externalRecordId ? 200 : 201,
        true,
      ),
    };
  }

  async assignOwner(
    externalRecordId: string,
    ownerExternalId: string,
  ): Promise<CrmAdapterCallResult<void>> {
    this.ownerAssignments.push({ externalRecordId, ownerExternalId });
    await Promise.resolve();
    return {
      result: undefined,
      requestSummary: buildSafeRequestSummary(
        "PATCH",
        `test://crm/contacts/${externalRecordId}/owner`,
      ),
      responseSummary: buildSafeResponseSummary(200, true),
    };
  }

  async updateStatus(
    externalRecordId: string,
    status: string,
  ): Promise<CrmAdapterCallResult<void>> {
    this.statusUpdates.push({ externalRecordId, status });
    await Promise.resolve();
    return {
      result: undefined,
      requestSummary: buildSafeRequestSummary(
        "PATCH",
        `test://crm/contacts/${externalRecordId}/status`,
      ),
      responseSummary: buildSafeResponseSummary(200, true),
    };
  }

  async createNote(
    externalRecordId: string,
    note: string,
  ): Promise<CrmAdapterCallResult<void>> {
    this.notes.push({ externalRecordId, note });
    await Promise.resolve();
    return {
      result: undefined,
      requestSummary: buildSafeRequestSummary(
        "POST",
        `test://crm/contacts/${externalRecordId}/notes`,
      ),
      responseSummary: buildSafeResponseSummary(201, true),
    };
  }

  async handleWebhook(request: CrmWebhookRequest): Promise<CrmWebhookEvent | null> {
    await Promise.resolve();
    try {
      return JSON.parse(request.rawBody) as CrmWebhookEvent;
    } catch {
      return null;
    }
  }

  async refreshCredentials(): Promise<CrmCredentials | null> {
    await Promise.resolve();
    return this.refreshedCredentials;
  }
}
