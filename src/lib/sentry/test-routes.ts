/**
 * Gate for the Sentry test error routes (spec §47 requirement 13:
 * "Development only test routes"). "Development only" here means
 * non-production: local `next dev`/`next build` and Vercel Preview
 * deployments are allowed (Preview is where these routes get exercised
 * per the Milestone 2 verification steps), but a real Vercel Production
 * deployment is not — `VERCEL_ENV` distinguishes Preview from Production
 * even though both build with `NODE_ENV=production` internally.
 */
export function areSentryTestRoutesEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV) {
    // A production build with no Vercel environment marker at all (e.g. a
    // local `next build && next start`) — treat as production-like and
    // block, the safe default per "remove or protect before production."
    return false;
  }
  return true;
}
