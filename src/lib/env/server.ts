import "server-only";
import { z } from "zod";

/**
 * Validated server-only environment variables. Importing "server-only"
 * makes Next.js throw a build error if this module is ever pulled into a
 * client bundle — see docs/security-model.md §3 and CLAUDE.md rule 5.
 *
 * Vars only needed by later milestones (email, CRM, geocoding, webhook
 * encryption, Sentry auth token) are declared optional here so Milestone 1
 * startup validation doesn't fail on an incomplete-for-later-milestones
 * .env — they will be tightened to required in the migration that first
 * consumes them.
 */
const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.email().optional(),
  CRM_CLIENT_ID: z.string().optional(),
  CRM_CLIENT_SECRET: z.string().optional(),
  CRM_REDIRECT_URI: z.url().optional(),
  GEOCODING_PROVIDER_KEY: z.string().optional(),
  WEBHOOK_ENCRYPTION_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid server environment configuration: ${result.error.message}`);
  }

  return result.data;
}

export const serverEnv: ServerEnv = loadServerEnv();
