import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env/public";

/**
 * Server Supabase client for Server Components, Server Actions, and Route
 * Handlers. Uses the publishable key (not the secret key) plus the caller's
 * session cookies — RLS still applies, this is not a privilege escalation.
 * See docs/security-model.md §2 for the official `@supabase/ssr` pattern
 * this follows.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component with no response to attach
            // cookies to — safe to ignore because middleware refreshes the
            // session on every request that matters for auth state.
          }
        },
      },
    },
  );
}
