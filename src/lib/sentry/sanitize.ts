import { ZodError } from "zod";
import type { ErrorEvent, Event, EventHint } from "@sentry/nextjs";
import { AppError } from "@/lib/errors/app-error";
import { SENTRY_ALLOWED_TAG_KEYS } from "./allowed-tags";

/**
 * Central Sentry sanitizer (spec §47, docs/security-model.md §7,
 * CLAUDE.md rule 18). Shared by the browser, Node, and Edge Sentry `init`
 * calls (src/instrumentation-client.ts, src/instrumentation.ts) so there is
 * exactly one place this policy is implemented and tested.
 *
 * Removes: names, emails, phones, addresses, form messages, original lead
 * payloads, custom variable values, cookies, authorization headers, access
 * tokens, refresh tokens, Supabase secret keys, CRM credentials, and Sentry
 * auth tokens. Allows only the internal UUID/enum diagnostic identifiers in
 * `SENTRY_ALLOWED_TAG_KEYS` plus Sentry's own top-level `environment`/
 * `release` fields.
 */

const SENSITIVE_HEADER_NAME_PATTERN = /authorization|cookie|token|secret|api[-_]?key/i;

/** Sentry-standard technical contexts that never carry application data. */
const SAFE_CONTEXT_NAMES = new Set([
  "browser",
  "os",
  "runtime",
  "device",
  "culture",
  "app",
  "cloud_resource",
  "react",
  "nextjs",
  "trace",
  "state",
]);

/**
 * Best-effort regex scrub for secret-shaped substrings that should never
 * appear in error text in the first place (defense in depth, not the
 * primary control — the primary control is never logging/throwing with
 * secrets embedded, per CLAUDE.md rule 18). Matches: Bearer tokens, JWT-
 * shaped strings (Supabase keys, access/refresh tokens are JWTs), and
 * common vendor secret-key prefixes (Stripe-style, generic CRM API keys).
 */
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT (Supabase secret/access/refresh tokens)
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/gi,
  /\b(?:sq0csp|sq0atp)-[A-Za-z0-9_-]{10,}\b/gi,
];

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    value,
  );
}

function isExpectedValidationError(hint?: EventHint): boolean {
  const original = hint?.originalException;
  if (original instanceof ZodError) {
    return true;
  }
  if (original instanceof AppError && original.code === "invalid_input") {
    return true;
  }
  return false;
}

function sanitizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADER_NAME_PATTERN.test(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

function sanitizeTags(tags: Event["tags"]): Event["tags"] {
  if (!tags) {
    return tags;
  }
  const safe: NonNullable<Event["tags"]> = {};
  for (const key of SENTRY_ALLOWED_TAG_KEYS) {
    if (key in tags) {
      safe[key] = tags[key];
    }
  }
  return safe;
}

function sanitizeContexts(contexts: Event["contexts"]): Event["contexts"] {
  if (!contexts) {
    return contexts;
  }
  const safe: NonNullable<Event["contexts"]> = {};
  for (const [name, value] of Object.entries(contexts)) {
    if (SAFE_CONTEXT_NAMES.has(name)) {
      safe[name] = value;
    }
  }
  return safe;
}

function sanitizeBreadcrumbs(breadcrumbs: Event["breadcrumbs"]): Event["breadcrumbs"] {
  if (!breadcrumbs) {
    return breadcrumbs;
  }
  return breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    message: breadcrumb.message ? redactSecrets(breadcrumb.message) : breadcrumb.message,
    // Breadcrumb `data` commonly carries fetch/XHR bodies and headers —
    // exactly the surfaces that could leak lead payloads or tokens. Drop
    // it wholesale rather than trying to allow-list its shape.
    data: undefined,
  }));
}

function sanitizeExceptionMessages(exception: Event["exception"]): Event["exception"] {
  if (!exception?.values) {
    return exception;
  }
  return {
    ...exception,
    values: exception.values.map((value) => ({
      ...value,
      value: value.value ? redactSecrets(value.value) : value.value,
    })),
  };
}

export function sentryBeforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  if (isExpectedValidationError(hint)) {
    return null;
  }

  // Never send default PII (belt-and-suspenders alongside sendDefaultPii:
  // false in Sentry.init — this strips it even if some call site sets it
  // explicitly via Sentry.setUser()).
  delete event.user;

  if (event.request) {
    event.request = {
      ...event.request,
      cookies: undefined,
      // Request bodies can contain original lead payloads, form messages,
      // or custom variable values submitted by a customer's website.
      data: undefined,
      headers: sanitizeHeaders(event.request.headers),
    };
  }

  // `extra` is a free-form bag callers can attach anything to — the
  // allow-listed tag channel (SENTRY_ALLOWED_TAG_KEYS) is the only
  // supported way to attach diagnostic identifiers, so extra is dropped
  // wholesale rather than partially trusted.
  delete event.extra;

  event.contexts = sanitizeContexts(event.contexts);
  event.tags = sanitizeTags(event.tags);
  event.breadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs);
  event.exception = sanitizeExceptionMessages(event.exception);

  if (event.message) {
    event.message = redactSecrets(event.message);
  }

  return event;
}
