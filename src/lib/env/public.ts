import { z } from "zod";

/**
 * Validated environment variables that are safe to reference from browser
 * bundles. Every key here MUST be prefixed NEXT_PUBLIC_ so Next.js inlines
 * it at build time — see docs/security-model.md §3.
 *
 * Only `process.env.NEXT_PUBLIC_*` (literal, static property access) is
 * replaced by Next.js's compiler in client bundles, so those lookups stay
 * inline below rather than going through a dynamic loop.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
  // Optional: Sentry is not required to run the app (docs/decisions.md
  // ADR-013/ADR-024). Read here (not lib/env/server) because the browser
  // Sentry init (src/instrumentation-client.ts) needs it, and NEXT_PUBLIC_*
  // vars are inlined by Next.js wherever they're statically referenced.
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function loadPublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  if (!result.success) {
    throw new Error(`Invalid public environment configuration: ${result.error.message}`);
  }

  return result.data;
}

export const publicEnv: PublicEnv = loadPublicEnv();
