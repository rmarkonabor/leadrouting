"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logging/logger";

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  await supabase.auth.signOut();

  if (data.user) {
    logger.info("user_signed_out", { user_id: data.user.id });
  }

  redirect("/login");
}
