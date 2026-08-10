/**
 * Builds integration_logs' request_summary/response_summary safely
 * (spec §44, kickoff requirement 6/13: "no sensitive credentials in logs
 * or Sentry"). The strategy is stricter than field-by-field redaction: a
 * request summary never includes any field *value* at all, only field
 * *names* and the request's method/URL (with the query string stripped,
 * since some CRM APIs pass an API key as a query param) — there is no way
 * for a credential or a lead's PII to leak through a summary that
 * structurally cannot carry values.
 */
export interface SafeRequestSummary {
  method: string;
  url: string;
  fieldNames: string[];
}

export interface SafeResponseSummary {
  statusCode: number | null;
  ok: boolean;
  errorMessage?: string;
}

function stripQueryString(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a full URL (e.g. a relative path already stripped) — return as-is.
    return url.split("?")[0] ?? url;
  }
}

export function buildSafeRequestSummary(
  method: string,
  url: string,
  body?: Record<string, unknown> | null,
): SafeRequestSummary {
  return {
    method,
    url: stripQueryString(url),
    fieldNames: body ? Object.keys(body) : [],
  };
}

/**
 * `errorMessage` must be a short, generic description (e.g. "not_found",
 * "rate_limited") — never the raw response body, which could echo back
 * request data (including PII) or a provider error page.
 */
export function buildSafeResponseSummary(
  statusCode: number | null,
  ok: boolean,
  errorMessage?: string,
): SafeResponseSummary {
  return errorMessage === undefined
    ? { statusCode, ok }
    : { statusCode, ok, errorMessage };
}
