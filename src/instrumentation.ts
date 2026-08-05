/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Importing the env modules here forces their Zod validation to run at
 * startup (spec §53: "All environment variables must be validated during
 * application startup"), rather than lazily on first use inside a request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env/public");
    await import("@/lib/env/server");
  }
}
