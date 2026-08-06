import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Live check for whether PostGIS is actually enabled on the connected
 * database — never assumed. Radius territories (spec §23 requirement 7) are
 * permitted only when this returns true, checked at the moment of use, not
 * cached at module-load time (the extension could theoretically be enabled
 * or dropped by a database admin between calls).
 */
export async function isPostgisAvailable(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_postgis_available");
  if (error) {
    return false;
  }
  return data === true;
}
