import { NextRequest, NextResponse } from "next/server";
import { createAnonSupabaseClient } from "@/lib/supabase/anon";
import {
  processLeadSubmission,
  type IntakeErrorCode,
} from "@/modules/lead-intake/process-submission";
import { logger } from "@/lib/logging/logger";

// This route is the one pre-auth request path in the codebase
// (docs/decisions.md ADR-011). It must never import
// "@/lib/supabase/service-role" — enforced by the ESLint import-boundary
// rule in eslint.config.mjs.

const ERROR_STATUS: Record<IntakeErrorCode, number> = {
  invalid_source: 404,
  source_inactive: 403,
  rate_limited: 429,
  invalid_signature: 401,
};

const ERROR_MESSAGE: Record<IntakeErrorCode, string> = {
  invalid_source: "Unknown lead source.",
  source_inactive: "This lead source is not accepting submissions.",
  rate_limited: "Too many requests. Please try again later.",
  invalid_signature: "Request signature verification failed.",
};

async function parseBody(
  request: NextRequest,
): Promise<{ payload: Record<string, unknown>; raw: string }> {
  const raw = await request.text();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return { payload: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, raw };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      payload[key] = value;
    }
    return { payload, raw };
  }

  throw new Error("unsupported_content_type");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sourceToken: string }> },
) {
  const { sourceToken } = await context.params;

  let payload: Record<string, unknown>;
  let raw: string;

  try {
    ({ payload, raw } = await parseBody(request));
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Request body must be JSON or form-encoded." },
      { status: 400 },
    );
  }

  const supabase = createAnonSupabaseClient();

  const [result, error] = await processLeadSubmission(supabase, {
    sourceToken,
    rawPayload: payload,
    rawBody: raw,
    idempotencyKey: request.headers.get("idempotency-key"),
    externalSubmissionId: request.headers.get("x-external-submission-id"),
    testMode: request.headers.get("x-test-mode")?.toLowerCase() === "true",
    signatureHeader: request.headers.get("x-signature"),
  }).then(
    (value) => [value, null] as const,
    (thrown: unknown) => [null, thrown] as const,
  );

  if (error || !result) {
    logger.error("lead_intake_failed", { error_code: "internal_error" });
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  if (!result.ok && result.errorCode) {
    return NextResponse.json(
      { error: result.errorCode, message: ERROR_MESSAGE[result.errorCode] },
      { status: ERROR_STATUS[result.errorCode] },
    );
  }

  if (result.validationErrors && result.validationErrors.length > 0) {
    return NextResponse.json(
      {
        error: "validation_failed",
        message: "The submission could not be validated.",
        details: result.validationErrors,
        submissionLogId: result.submissionLogId,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(
    {
      received: true,
      testMode: result.testMode ?? false,
      submissionLogId: result.submissionLogId,
      leadId: result.leadId ?? null,
    },
    { status: 201 },
  );
}
