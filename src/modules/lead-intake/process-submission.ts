import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  LeadDuplicateAction,
  LeadDuplicateMatchBasis,
} from "@/lib/supabase/database.types";
import { hashSourceToken } from "@/modules/lead-sources/lead-sources";
import { mapPayload, type FieldMappingConfig } from "@/modules/field-mapping/map-payload";
import { validateLeadFields } from "./validate-lead-fields";
import {
  validateCustomValue,
  type CustomVariableDefinitionLike,
} from "@/modules/field-mapping/validate-custom-value";
import { findDuplicateMatch } from "@/modules/duplicate-detection/find-duplicate-match";
import { decideDuplicateOutcome } from "@/modules/duplicate-detection/decide-duplicate-outcome";

export interface IntakeRequest {
  sourceToken: string;
  rawPayload: Record<string, unknown>;
  rawBody: string;
  idempotencyKey: string | null;
  externalSubmissionId: string | null;
  testMode: boolean;
  signatureHeader: string | null;
}

export type IntakeErrorCode =
  "invalid_source" | "source_inactive" | "rate_limited" | "invalid_signature";

export interface IntakeResult {
  ok: boolean;
  errorCode?: IntakeErrorCode;
  submissionLogId?: string;
  leadId?: string | null;
  validationErrors?: string[];
  testMode?: boolean;
}

/**
 * Constant-time HMAC-SHA256 signature check (docs/security-model.md §4).
 * `timingSafeEqual` requires equal-length buffers, so a length mismatch is
 * checked first and short-circuits to `false` without ever comparing bytes.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string,
  signingSecret: string,
): boolean {
  const expected = createHmac("sha256", signingSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * The full intake pipeline (spec §18): resolve source, rate limit, verify
 * signature, map fields, validate, detect duplicates, then record the
 * result atomically via `record_lead_submission`. Runs against the
 * session-less anon Supabase client (docs/decisions.md ADR-011) — every
 * privileged step goes through a narrow RPC, never the service-role client
 * (enforced by the ESLint import-boundary rule, which excludes this route).
 */
export async function processLeadSubmission(
  supabase: SupabaseClient<Database>,
  request: IntakeRequest,
): Promise<IntakeResult> {
  const tokenHash = hashSourceToken(request.sourceToken);

  const { data: sourceRows, error: sourceError } = await supabase.rpc(
    "resolve_lead_source",
    {
      p_token_hash: tokenHash,
    },
  );

  if (sourceError || !sourceRows || sourceRows.length === 0) {
    return { ok: false, errorCode: "invalid_source" };
  }

  const source = sourceRows[0];
  if (!source) {
    return { ok: false, errorCode: "invalid_source" };
  }

  if (source.status !== "active") {
    return { ok: false, errorCode: "source_inactive" };
  }

  const rateLimitSettings = source.rate_limit_settings as {
    windowSeconds?: number;
    maxRequests?: number;
  };
  const windowSeconds = rateLimitSettings.windowSeconds ?? 60;
  const maxRequests = rateLimitSettings.maxRequests ?? 120;

  const { data: allowed, error: rateLimitError } = await supabase.rpc(
    "check_and_increment_intake_rate_limit",
    {
      p_lead_source_id: source.lead_source_id,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests,
    },
  );

  if (rateLimitError) {
    return { ok: false, errorCode: "invalid_source" };
  }
  if (!allowed) {
    return { ok: false, errorCode: "rate_limited" };
  }

  const signatureSettings = source.signature_settings as {
    enabled?: boolean;
    signingSecret?: string;
  };
  if (signatureSettings.enabled) {
    if (
      !request.signatureHeader ||
      !signatureSettings.signingSecret ||
      !verifySignature(
        request.rawBody,
        request.signatureHeader,
        signatureSettings.signingSecret,
      )
    ) {
      return { ok: false, errorCode: "invalid_signature" };
    }
  }

  const { data: mappingRows } = await supabase
    .from("field_mappings")
    .select()
    .eq("lead_source_id", source.lead_source_id);

  const mappings: FieldMappingConfig[] = (mappingRows ?? []).map((m) => ({
    sourceFieldName: m.source_field_name,
    destinationType: m.destination_type,
    destinationField: m.destination_field,
    dataType: m.data_type,
    required: m.required,
    defaultValue: m.default_value,
    transformation: m.transformation,
    validationRule: (m.validation_rule ?? {}) as FieldMappingConfig["validationRule"],
  }));

  const { mappedFields, customValues } = mapPayload(request.rawPayload, mappings);
  const fieldErrors = validateLeadFields(mappedFields, mappings);

  const { data: definitionRows } = await supabase
    .from("custom_variable_definitions")
    .select()
    .eq("organization_id", source.organization_id)
    .eq("active", true);

  const customValueErrors: string[] = [];
  const customValuesForWrite: Array<{ variable_definition_id: string; value: unknown }> =
    [];

  for (const definition of definitionRows ?? []) {
    const rawValue = customValues[definition.internal_key];
    const definitionLike: CustomVariableDefinitionLike = {
      internalKey: definition.internal_key,
      fieldType: definition.field_type,
      required: definition.required,
      options: definition.options,
      validationRules: (definition.validation_rules ??
        {}) as CustomVariableDefinitionLike["validationRules"],
    };
    const error = validateCustomValue(definitionLike, rawValue);

    if (error) {
      customValueErrors.push(error);
    } else if (rawValue !== undefined) {
      customValuesForWrite.push({
        variable_definition_id: definition.id,
        value: rawValue,
      });
    }
  }

  const validationErrors = [...fieldErrors, ...customValueErrors];

  let duplicateOfLeadId: string | null = null;
  let matchBasis: LeadDuplicateMatchBasis | null = null;
  let duplicateAction: LeadDuplicateAction | null = null;
  let leadDuplicateStatus: "unique" | "possible_duplicate" | "duplicate" = "unique";

  if (validationErrors.length === 0) {
    const { data: org } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", source.organization_id)
      .single();

    const duplicateSettings =
      (
        org?.settings as {
          duplicateDetection?: { windowHours?: number; action?: LeadDuplicateAction };
        }
      )?.duplicateDetection ?? {};
    const windowHours = duplicateSettings.windowHours ?? 24;
    const configuredAction = duplicateSettings.action ?? "flag_and_continue";

    const match = await findDuplicateMatch(
      supabase,
      source.organization_id,
      source.lead_source_id,
      {
        externalSubmissionId: request.externalSubmissionId,
        email: typeof mappedFields.email === "string" ? mappedFields.email : null,
        phone: typeof mappedFields.phone === "string" ? mappedFields.phone : null,
      },
      windowHours,
    );

    const outcome = decideDuplicateOutcome(match?.matchBasis ?? null, configuredAction);
    leadDuplicateStatus = outcome.duplicateStatus;
    duplicateAction = outcome.action;
    matchBasis = match?.matchBasis ?? null;
    duplicateOfLeadId = outcome.action ? (match?.leadId ?? null) : null;
  }

  const shouldCreateLead =
    !request.testMode &&
    validationErrors.length === 0 &&
    duplicateAction !== "reject_submission";

  const submissionStatus = request.testMode
    ? "received"
    : validationErrors.length > 0
      ? "failed"
      : "validated";

  const { data: recordRows, error: recordError } = await supabase.rpc(
    "record_lead_submission",
    {
      p_lead_source_id: source.lead_source_id,
      p_idempotency_key: request.idempotencyKey,
      p_external_submission_id: request.externalSubmissionId,
      p_raw_payload: request.rawPayload,
      p_mapped_payload: mappedFields,
      p_validation_errors: validationErrors,
      p_submission_status: submissionStatus,
      p_test_mode: request.testMode,
      p_lead_fields: shouldCreateLead ? mappedFields : null,
      p_lead_duplicate_status: leadDuplicateStatus,
      p_custom_values: shouldCreateLead ? customValuesForWrite : null,
      p_duplicate_of_lead_id: shouldCreateLead ? duplicateOfLeadId : null,
      p_match_basis: shouldCreateLead ? matchBasis : null,
      p_duplicate_action: shouldCreateLead ? duplicateAction : null,
    },
  );

  const recorded = recordRows?.[0];
  if (recordError || !recorded) {
    throw new Error("Failed to record lead submission.");
  }

  return {
    ok: true,
    submissionLogId: recorded.submission_log_id,
    leadId: recorded.lead_id,
    validationErrors,
    testMode: request.testMode,
  };
}
