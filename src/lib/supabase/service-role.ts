import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely. This
 * is the first milestone that needs it (Supabase Auth Admin API calls for
 * user invitation, which cannot be performed with the publishable key). Per
 * docs/security-model.md §3, its use is confined to a narrow, explicitly
 * allow-listed set of trusted server contexts: this file must never be
 * imported by anything reachable from a client bundle, and never by the
 * public lead-intake route. The `eslint.config.mjs` `no-restricted-imports`
 * override enforces the allow-list at build time — see docs/decisions.md
 * ADR-022.
 *
 * Every caller of this client is itself gated by an explicit org_admin
 * authorization check performed *before* this client is used, so a bug here
 * cannot silently grant cross-organization access — RLS bypass is not the
 * only line of defense (docs/security-model.md §1).
 */
export function createServiceRoleClient() {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
