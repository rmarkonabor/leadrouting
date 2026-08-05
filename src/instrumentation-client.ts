import * as Sentry from "@sentry/nextjs";
import { getSharedSentryInitOptions } from "@/lib/sentry/init-options";

/**
 * Browser Sentry init. Next.js loads this file automatically (the current,
 * Turbopack-compatible mechanism — replaces the older `sentry.client.config.ts`
 * convention). See docs/decisions.md ADR-018.
 */
Sentry.init({
  ...getSharedSentryInitOptions(),
  // Session Replay is intentionally not enabled for Phase 1 (spec §47:
  // "Keep Session Replay disabled during Phase 1") — no replayIntegration()
  // is added here.
  integrations: [Sentry.browserTracingIntegration()],
});

// Required by the SDK to instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
