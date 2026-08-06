import * as Sentry from "@sentry/nextjs";
import type { SentryDiagnosticContext } from "./allowed-tags";

/**
 * The only supported way application code attaches diagnostic identifiers
 * to a Sentry event. Only keys in `SentryDiagnosticContext`
 * (`SENTRY_ALLOWED_TAG_KEYS`) are accepted at the type level, and
 * `sentryBeforeSend` re-enforces the same allow-list at runtime in case a
 * future caller bypasses this helper — see docs/security-model.md §7.
 *
 * Example: `setSentryDiagnosticContext({ organization_id: org.id, lead_id: lead.id })`
 * before a routing/assignment operation that might throw.
 */
export function setSentryDiagnosticContext(context: SentryDiagnosticContext): void {
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      Sentry.setTag(key, value);
    }
  }
}
