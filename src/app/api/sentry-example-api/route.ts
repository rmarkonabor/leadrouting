import { NextResponse } from "next/server";
import { areSentryTestRoutesEnabled } from "@/lib/sentry/test-routes";

/**
 * Development/Preview-only route that intentionally throws, to verify
 * server-side (Route Handler) error capture reaches Sentry with a readable
 * TypeScript stack trace. Never available in a real production deployment
 * — see areSentryTestRoutesEnabled().
 */
export async function GET() {
  if (!areSentryTestRoutesEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  throw new Error("Sentry server test error (sentry-example-api route handler)");
}
