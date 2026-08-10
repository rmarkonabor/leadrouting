import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";

const addNoteInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

/**
 * Adds a note to a lead via the `add_note` DB function (spec §36.3 item 6).
 * The function itself inserts both the `notes` row and the matching
 * `activities` row atomically, and relies on `notes_insert_scoped` RLS
 * (same lead-visibility join as `leads_select_scoped`) to reject notes on
 * leads the caller cannot see — this module never needs its own visibility
 * check.
 */
export async function addNote(
  organizationSlug: string | undefined,
  leadId: string,
  content: string,
) {
  await requireMembershipContext(organizationSlug);

  const parsed = addNoteInputSchema.safeParse({ content });
  if (!parsed.success) {
    throw new AppError(
      "invalid_input",
      "Note content must be between 1 and 5000 characters.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("add_note", {
    p_lead_id: leadId,
    p_content: parsed.data.content,
  });

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/** Lists notes for a lead, newest first. RLS (`notes_select_scoped`) gates visibility. */
export async function listNotes(organizationSlug: string | undefined, leadId: string) {
  await requireMembershipContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error) {
    throw toAppError(error);
  }

  return data ?? [];
}
