import "server-only";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./server";

/**
 * The ONLY sanctioned way to identify the caller for an authorization
 * decision. Calls `supabase.auth.getUser()`, which revalidates the token
 * against the Supabase Auth server, rather than `getSession()`, which only
 * decodes the session cookie locally and can be satisfied by a stale or
 * tampered cookie. See docs/security-model.md §2 and docs/decisions.md
 * ADR-010.
 *
 * `getSession()` must never be used for an authorization decision anywhere
 * in this codebase — only this helper (or the equivalent direct
 * `supabase.auth.getUser()` call inside it) may back a permission check.
 */
export async function getVerifiedUser(): Promise<User | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}
