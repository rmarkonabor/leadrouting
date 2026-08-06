import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook — runs once when the server process starts,
 * for both the Node.js and Edge runtimes (branched on `NEXT_RUNTIME`).
 *
 * Two responsibilities:
 * 1. Force the env modules' Zod validation to run at startup (spec §53:
 *    "All environment variables must be validated during application
 *    startup"), rather than lazily on first use inside a request.
 * 2. Initialize Sentry for server-side error/trace capture. See
 *    docs/decisions.md ADR-018 for why this file (not separate
 *    `sentry.server.config.ts`/`sentry.edge.config.ts` files) is the
 *    current, Turbopack-compatible place to do this.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env/public");
    await import("@/lib/env/server");

    const { getSharedSentryInitOptions } = await import("@/lib/sentry/init-options");
    Sentry.init(getSharedSentryInitOptions());
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { getSharedSentryInitOptions } = await import("@/lib/sentry/init-options");
    Sentry.init(getSharedSentryInitOptions());
  }
}

/**
 * Next.js's official `onRequestError` hook (stable since Next 15): reports
 * errors from Server Components, Route Handlers, Server Actions, and
 * middleware/proxy through the same sanitized Sentry pipeline — this is
 * what satisfies "Server error monitoring," "Route Handler error
 * monitoring," and "Server Action error monitoring" without needing to
 * manually wrap every handler.
 */
export const onRequestError = Sentry.captureRequestError;
