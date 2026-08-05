import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {/* config options here */};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Never NEXT_PUBLIC_* — this must stay server/build-only (CLAUDE.md rule 5).
  // The plugin uses it only during `next build` to upload source maps; it is
  // never bundled into the app itself. Source map upload is skipped
  // gracefully (with a warning) when this or org/project is unset, e.g. in
  // local development without Sentry configured.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Reduce local/CI log noise; Vercel build logs still show plugin errors.
  silent: !process.env.CI,

  // Upload source maps for the full client bundle, not just page/app
  // chunks, so stack traces resolve to real TypeScript source everywhere.
  widenClientFileUpload: true,

  // `disableLogger`/`automaticVercelMonitors` are webpack-only options (the
  // SDK warns they're "not supported with Turbopack") — this project always
  // builds with Turbopack (Next.js 16 default), so they're intentionally
  // omitted rather than set to a value that would silently no-op.
});
