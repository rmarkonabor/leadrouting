import type {
  LeadDuplicateAction,
  LeadDuplicateMatchBasis,
  LeadDuplicateStatus,
} from "@/lib/supabase/database.types";

export interface DuplicateOutcome {
  duplicateStatus: LeadDuplicateStatus;
  /** null when there was no match at all — nothing to record in lead_duplicates. */
  action: LeadDuplicateAction | null;
}

/**
 * Maps a duplicate match (or lack of one) plus the organization's configured
 * duplicate-handling action into the outcome the intake pipeline acts on
 * (spec §21's four supported actions). Pure and unit-testable.
 */
export function decideDuplicateOutcome(
  matchBasis: LeadDuplicateMatchBasis | null,
  configuredAction: LeadDuplicateAction,
): DuplicateOutcome {
  if (!matchBasis) {
    return { duplicateStatus: "unique", action: null };
  }

  switch (configuredAction) {
    case "flag_and_continue":
    case "send_to_manual_review":
      return { duplicateStatus: "possible_duplicate", action: configuredAction };
    case "update_existing":
    case "reject_submission":
      return { duplicateStatus: "duplicate", action: configuredAction };
  }
}
