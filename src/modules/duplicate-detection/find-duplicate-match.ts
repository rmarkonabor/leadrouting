import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LeadDuplicateMatchBasis } from "@/lib/supabase/database.types";

export interface DuplicateCandidate {
  externalSubmissionId?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface DuplicateMatch {
  leadId: string;
  matchBasis: LeadDuplicateMatchBasis;
}

/**
 * Looks for an existing lead matching the incoming submission within the
 * configurable duplicate window (spec §21): external submission id, then
 * normalized email, then normalized phone, in that priority order.
 * Idempotency-key matching is handled separately, at the database layer, by
 * `record_lead_submission`'s own exact-match check against
 * `submission_logs` (docs/decisions.md).
 */
export async function findDuplicateMatch(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  leadSourceId: string,
  candidate: DuplicateCandidate,
  windowHours: number,
): Promise<DuplicateMatch | null> {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  if (candidate.externalSubmissionId) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("lead_source_id", leadSourceId)
      .eq("external_submission_id", candidate.externalSubmissionId)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (data) {
      return { leadId: data.id, matchBasis: "external_submission_id" };
    }
  }

  if (candidate.email) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", candidate.email)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (data) {
      return { leadId: data.id, matchBasis: "email" };
    }
  }

  if (candidate.phone) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", candidate.phone)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (data) {
      return { leadId: data.id, matchBasis: "phone" };
    }
  }

  return null;
}
