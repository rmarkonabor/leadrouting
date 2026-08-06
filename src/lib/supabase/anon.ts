import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env/public";

/**
 * A session-less Supabase client using the publishable key, for the one
 * pre-auth request path in the codebase: `POST /api/v1/intake/[sourceToken]`
 * (docs/decisions.md ADR-011). No cookies, no user — RLS treats every call
 * as the `anon` role, which is why `resolve_lead_source`,
 * `check_and_increment_intake_rate_limit`, and `record_lead_submission` are
 * the only things this client is ever used to call.
 */
export function createAnonSupabaseClient() {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
