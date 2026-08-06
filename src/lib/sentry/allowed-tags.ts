/**
 * The only tag/context keys allowed to reach Sentry (docs/security-model.md
 * §7, spec §47's "allowed diagnostic identifiers" list). These are internal
 * UUIDs/enums, never personal data — everything else is stripped by
 * `sentryBeforeSend` regardless of where in the event it appears.
 */
export const SENTRY_ALLOWED_TAG_KEYS = [
  "organization_id",
  "lead_id",
  "assignment_id",
  "routing_flow_id",
  "routing_flow_version_id",
  "source_id",
  "job_id",
  "integration_provider",
] as const;

export type SentryAllowedTagKey = (typeof SENTRY_ALLOWED_TAG_KEYS)[number];

export type SentryDiagnosticContext = Partial<Record<SentryAllowedTagKey, string>>;
