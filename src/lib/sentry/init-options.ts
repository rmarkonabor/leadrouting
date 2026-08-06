import { publicEnv } from "@/lib/env/public";
import { sentryBeforeSend } from "./sanitize";

/**
 * Vercel sets `VERCEL_ENV` to exactly `production` | `preview` |
 * `development` on every deployment; it's unset for plain local `next dev`,
 * which also means "development" here. This is what makes environments
 * separate in Sentry (spec §47 requirement 7) without any extra
 * configuration in Vercel itself.
 */
export function getSentryEnvironment(): "production" | "preview" | "development" {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") {
    return vercelEnv;
  }
  return "development";
}

/**
 * Conservative production trace sampling: 10% in production keeps
 * performance overhead and event volume low at real traffic, while
 * preview/development get full sampling since traffic there is low and
 * full visibility is more useful than sampling savings.
 */
export function getTracesSampleRate(): number {
  return getSentryEnvironment() === "production" ? 0.1 : 1.0;
}

export function isSentryEnabled(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_SENTRY_DSN);
}

/**
 * Options shared by every runtime's Sentry.init call (browser, Node, Edge).
 * Runtime-specific files add their own integrations on top of this.
 */
export function getSharedSentryInitOptions() {
  return {
    dsn: publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    environment: getSentryEnvironment(),
    tracesSampleRate: getTracesSampleRate(),
    // Never attach IP addresses, cookies, or headers by default — the
    // sanitizer below is the second layer, this is the first (spec §47).
    sendDefaultPii: false,
    beforeSend: sentryBeforeSend,
  } as const;
}
