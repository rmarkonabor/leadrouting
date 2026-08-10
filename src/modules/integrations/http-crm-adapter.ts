import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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
import { serverEnv } from "@/lib/env/server";

/**
 * The one concrete CRM adapter (spec §42), generic and settings-configured
 * rather than tied to a named vendor (docs/decisions.md ADR-053). Expected
 * `settings` shape:
 * ```
 * {
 *   baseUrl: string,               // e.g. "https://api.example-crm.com/v1"
 *   contactsPath?: string,         // default "/contacts"
 *   usersPath?: string,            // default "/users"
 *   authHeader?: string,           // default "Authorization"
 *   authScheme?: string,           // default "Bearer"
 *   tokenUrl?: string,             // OAuth2 refresh endpoint, if refreshCredentials applies
 *   inboundWebhookSecret?: string, // shared secret verifying handleWebhook calls
 *   webhookSignatureHeader?: string, // default "x-webhook-signature"
 *   webhookRecordIdField?: string, // default "id"
 *   webhookStatusField?: string,   // default "status"
 * }
 * ```
 * `credentials` shape: `{ accessToken: string, refreshToken?: string }`.
 * `CRM_CLIENT_ID`/`CRM_CLIENT_SECRET` (server-only env vars) are the single
 * app-level OAuth2 client registered with whichever provider an org
 * connects to — one registration, many per-org authorizations, the normal
 * shape of a multi-tenant OAuth integration.
 */
export class HttpCrmAdapter implements CrmAdapter {
  private settings: CrmConnectionSettings = {};
  private credentials: CrmCredentials = {};

  async connect(
    settings: CrmConnectionSettings,
    credentials: CrmCredentials,
  ): Promise<void> {
    this.settings = settings;
    this.credentials = credentials;
    await Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.settings = {};
    this.credentials = {};
    await Promise.resolve();
  }

  private baseUrl(): string {
    const baseUrl = this.settings.baseUrl;
    if (typeof baseUrl !== "string" || !baseUrl) {
      throw new Error("CRM connection settings.baseUrl is not configured.");
    }
    return baseUrl;
  }

  private authHeaders(): Record<string, string> {
    const headerName =
      (this.settings.authHeader as string | undefined) ?? "Authorization";
    const scheme = (this.settings.authScheme as string | undefined) ?? "Bearer";
    const accessToken = this.credentials.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("CRM connection has no accessToken credential.");
    }
    return { [headerName]: `${scheme} ${accessToken}` };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<CrmAdapterCallResult<T>> {
    const url = `${this.baseUrl()}${path}`;
    const requestSummary = buildSafeRequestSummary(method, url, body);

    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      return {
        result: undefined as T,
        requestSummary,
        responseSummary: buildSafeResponseSummary(
          response.status,
          false,
          `http_${response.status}`,
        ),
      };
    }

    const result =
      response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    return {
      result,
      requestSummary,
      responseSummary: buildSafeResponseSummary(response.status, true),
    };
  }

  async testConnection(): Promise<CrmAdapterCallResult<{ ok: boolean }>> {
    const { responseSummary, requestSummary } = await this.request<unknown>(
      "GET",
      (this.settings.usersPath as string | undefined) ?? "/users",
    );
    return { result: { ok: responseSummary.ok }, requestSummary, responseSummary };
  }

  async listUsers(): Promise<CrmAdapterCallResult<CrmUser[]>> {
    const { result, requestSummary, responseSummary } = await this.request<
      Array<{ id: string; name: string; email?: string }>
    >("GET", (this.settings.usersPath as string | undefined) ?? "/users");
    return {
      result: (result ?? []).map((u) => ({
        externalId: u.id,
        name: u.name,
        email: u.email,
      })),
      requestSummary,
      responseSummary,
    };
  }

  async createOrUpdateContact(
    contact: CrmContactInput,
  ): Promise<CrmAdapterCallResult<CrmContactResult>> {
    const contactsPath =
      (this.settings.contactsPath as string | undefined) ?? "/contacts";
    const method = contact.externalRecordId ? "PATCH" : "POST";
    const path = contact.externalRecordId
      ? `${contactsPath}/${contact.externalRecordId}`
      : contactsPath;

    const { result, requestSummary, responseSummary } = await this.request<{
      id: string;
    }>(method, path, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      ...contact.fields,
    });

    return {
      result: { externalRecordId: result?.id ?? contact.externalRecordId ?? "" },
      requestSummary,
      responseSummary,
    };
  }

  async assignOwner(
    externalRecordId: string,
    ownerExternalId: string,
  ): Promise<CrmAdapterCallResult<void>> {
    const contactsPath =
      (this.settings.contactsPath as string | undefined) ?? "/contacts";
    const { requestSummary, responseSummary } = await this.request(
      "PATCH",
      `${contactsPath}/${externalRecordId}`,
      { ownerId: ownerExternalId },
    );
    return { result: undefined, requestSummary, responseSummary };
  }

  async updateStatus(
    externalRecordId: string,
    status: string,
  ): Promise<CrmAdapterCallResult<void>> {
    const contactsPath =
      (this.settings.contactsPath as string | undefined) ?? "/contacts";
    const { requestSummary, responseSummary } = await this.request(
      "PATCH",
      `${contactsPath}/${externalRecordId}`,
      { status },
    );
    return { result: undefined, requestSummary, responseSummary };
  }

  async createNote(
    externalRecordId: string,
    note: string,
  ): Promise<CrmAdapterCallResult<void>> {
    const contactsPath =
      (this.settings.contactsPath as string | undefined) ?? "/contacts";
    const { requestSummary, responseSummary } = await this.request(
      "POST",
      `${contactsPath}/${externalRecordId}/notes`,
      { body: note },
    );
    return { result: undefined, requestSummary, responseSummary };
  }

  async handleWebhook(request: CrmWebhookRequest): Promise<CrmWebhookEvent | null> {
    const secret = this.settings.inboundWebhookSecret as string | undefined;
    if (secret) {
      const headerName = (
        (this.settings.webhookSignatureHeader as string | undefined) ??
        "x-webhook-signature"
      ).toLowerCase();
      const provided = request.headers[headerName];
      const expected = createHmac("sha256", secret).update(request.rawBody).digest("hex");
      if (
        !provided ||
        provided.length !== expected.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
      ) {
        return null;
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(request.rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }

    const recordIdField =
      (this.settings.webhookRecordIdField as string | undefined) ?? "id";
    const statusField =
      (this.settings.webhookStatusField as string | undefined) ?? "status";
    const externalRecordId = parsed[recordIdField];
    const crmStatus = parsed[statusField];
    if (typeof externalRecordId !== "string" || typeof crmStatus !== "string") {
      return null;
    }

    return { externalRecordId, crmStatus };
  }

  async refreshCredentials(): Promise<CrmCredentials | null> {
    const tokenUrl = this.settings.tokenUrl as string | undefined;
    const refreshToken = this.credentials.refreshToken as string | undefined;
    if (
      !tokenUrl ||
      !refreshToken ||
      !serverEnv.CRM_CLIENT_ID ||
      !serverEnv.CRM_CLIENT_SECRET
    ) {
      return null;
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: serverEnv.CRM_CLIENT_ID,
        client_secret: serverEnv.CRM_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
    };
  }
}
