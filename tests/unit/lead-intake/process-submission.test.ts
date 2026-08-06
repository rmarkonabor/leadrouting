import { describe, expect, it, vi } from "vitest";
import { processLeadSubmission } from "@/modules/lead-intake/process-submission";
import { hashSourceToken } from "@/modules/lead-sources/lead-sources";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

interface MockOptions {
  sourceStatus?: "active" | "inactive";
  rateLimitAllowed?: boolean;
  fieldMappings?: unknown[];
  customVariableDefinitions?: unknown[];
  organizationSettings?: Record<string, unknown>;
  existingLeadMatch?: { id: string } | null;
  recordLeadSubmissionResult?: { submission_log_id: string; lead_id: string | null };
}

function makeSupabaseMock(options: MockOptions) {
  const recordLeadSubmission = vi.fn(async () => ({
    data: [
      options.recordLeadSubmissionResult ?? {
        submission_log_id: "log-1",
        lead_id: "lead-1",
      },
    ],
    error: null,
  }));

  const rpc = vi.fn((name: string) => {
    if (name === "resolve_lead_source") {
      return Promise.resolve({
        data: [
          {
            lead_source_id: SOURCE_ID,
            organization_id: ORG_ID,
            status: options.sourceStatus ?? "active",
            rate_limit_settings: { windowSeconds: 60, maxRequests: 100 },
            signature_settings: { enabled: false },
          },
        ],
        error: null,
      });
    }
    if (name === "check_and_increment_intake_rate_limit") {
      return Promise.resolve({ data: options.rateLimitAllowed ?? true, error: null });
    }
    if (name === "record_lead_submission") {
      return recordLeadSubmission();
    }
    throw new Error(`unexpected rpc ${name}`);
  });

  const from = vi.fn((table: string) => {
    if (table === "field_mappings") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: options.fieldMappings ?? [], error: null }),
        }),
      };
    }
    if (table === "custom_variable_definitions") {
      return {
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: options.customVariableDefinitions ?? [],
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === "organizations") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { settings: options.organizationSettings ?? {} },
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === "leads") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: options.existingLeadMatch ?? null,
                      error: null,
                    }),
                }),
              }),
            }),
            gte: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: options.existingLeadMatch ?? null,
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from, rpc, recordLeadSubmission } as never;
}

const baseRequest = {
  sourceToken: "lrt_plaintexttoken",
  rawPayload: { first_name: "John", email: "john@example.com" },
  rawBody: "{}",
  idempotencyKey: "idem-1",
  externalSubmissionId: null,
  testMode: false,
  signatureHeader: null,
};

describe("processLeadSubmission", () => {
  it("rejects an unknown source token", async () => {
    const supabase = makeSupabaseMock({});
    (supabase as { rpc: ReturnType<typeof vi.fn> }).rpc = vi.fn((name: string) =>
      name === "resolve_lead_source"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: null }),
    );

    const result = await processLeadSubmission(supabase, baseRequest);
    expect(result).toEqual({ ok: false, errorCode: "invalid_source" });
  });

  it("rejects an inactive source", async () => {
    const supabase = makeSupabaseMock({ sourceStatus: "inactive" });
    const result = await processLeadSubmission(supabase, baseRequest);
    expect(result).toEqual({ ok: false, errorCode: "source_inactive" });
  });

  it("rejects when the rate limit is exceeded", async () => {
    const supabase = makeSupabaseMock({ rateLimitAllowed: false });
    const result = await processLeadSubmission(supabase, baseRequest);
    expect(result).toEqual({ ok: false, errorCode: "rate_limited" });
  });

  it("does not create a lead in test mode, even for an otherwise-valid submission", async () => {
    const supabase = makeSupabaseMock({
      fieldMappings: [
        {
          source_field_name: "email",
          destination_type: "default_field",
          destination_field: "email",
          data_type: "text",
          required: true,
          default_value: null,
          transformation: null,
          validation_rule: {},
        },
      ],
      recordLeadSubmissionResult: { submission_log_id: "log-1", lead_id: null },
    });

    const result = await processLeadSubmission(supabase, {
      ...baseRequest,
      testMode: true,
    });

    expect(result.ok).toBe(true);
    expect(result.leadId).toBeNull();
    const call = (supabase as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls.find(
      ([name]) => name === "record_lead_submission",
    );
    expect(call?.[1]).toMatchObject({ p_test_mode: true, p_lead_fields: null });
  });

  it("records validation failures without creating a lead when a required field is missing", async () => {
    const supabase = makeSupabaseMock({
      fieldMappings: [
        {
          source_field_name: "email",
          destination_type: "default_field",
          destination_field: "email",
          data_type: "text",
          required: true,
          default_value: null,
          transformation: null,
          validation_rule: {},
        },
      ],
      recordLeadSubmissionResult: { submission_log_id: "log-1", lead_id: null },
    });

    const result = await processLeadSubmission(supabase, {
      ...baseRequest,
      rawPayload: {},
    });

    expect(result.ok).toBe(true);
    expect(result.validationErrors).toContain("email is required.");
    const call = (supabase as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls.find(
      ([name]) => name === "record_lead_submission",
    );
    expect(call?.[1]).toMatchObject({
      p_lead_fields: null,
      p_submission_status: "failed",
    });
  });

  it("does not create a lead when the organization's duplicate action is reject_submission", async () => {
    const supabase = makeSupabaseMock({
      fieldMappings: [
        {
          source_field_name: "email",
          destination_type: "default_field",
          destination_field: "email",
          data_type: "text",
          required: false,
          default_value: null,
          transformation: null,
          validation_rule: {},
        },
      ],
      organizationSettings: {
        duplicateDetection: { action: "reject_submission", windowHours: 24 },
      },
      existingLeadMatch: { id: "existing-lead" },
      recordLeadSubmissionResult: { submission_log_id: "log-1", lead_id: null },
    });

    const result = await processLeadSubmission(supabase, baseRequest);

    expect(result.ok).toBe(true);
    const call = (supabase as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls.find(
      ([name]) => name === "record_lead_submission",
    );
    expect(call?.[1]).toMatchObject({ p_lead_fields: null });
  });

  it("passes the same idempotency key through unchanged so the database function can dedupe", async () => {
    const supabase = makeSupabaseMock({});
    await processLeadSubmission(supabase, baseRequest);

    const call = (supabase as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls.find(
      ([name]) => name === "record_lead_submission",
    );
    expect(call?.[1]).toMatchObject({ p_idempotency_key: "idem-1" });
  });
});

describe("hashSourceToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashSourceToken("abc")).toBe(hashSourceToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashSourceToken("abc")).not.toBe(hashSourceToken("xyz"));
  });
});
