/**
 * Structured, PII-safe logging (CLAUDE.md rule 18, docs/security-model.md §7).
 *
 * Context objects are allow-listed: any key not on this list is dropped
 * (fail safe, not "redacted" — never logged in any form) rather than passed
 * through. Names, emails, phones, addresses, messages, consent text, and
 * custom variable values are never valid keys here — if a caller needs to
 * reference a lead, it logs `lead_id`, not the lead's contact fields.
 */
const ALLOWED_CONTEXT_KEYS = new Set([
  "organization_id",
  "user_id",
  "actor_user_id",
  "role",
  "request_id",
  "lead_id",
  "assignment_id",
  "routing_flow_id",
  "routing_flow_version_id",
  "source_id",
  "job_id",
  "integration_provider",
  "environment",
  "release",
  "status",
  "error_code",
  "duration_ms",
]);

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, string | number | boolean | null | undefined>;

function sanitizeContext(context?: LogContext): Record<string, unknown> {
  if (!context) {
    return {};
  }

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (ALLOWED_CONTEXT_KEYS.has(key)) {
      safe[key] = value;
    } else if (process.env.NODE_ENV !== "production") {
      // Fail loudly in development so a disallowed key is caught before
      // it ever reaches a real environment.
      console.warn(
        `[logger] dropped disallowed context key "${key}" — see docs/security-model.md §7`,
      );
    }
  }
  return safe;
}

function emit(level: LogLevel, event: string, context?: LogContext): void {
  const entry = {
    level,
    event,
    time: new Date().toISOString(),
    ...sanitizeContext(context),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => emit("debug", event, context),
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};
