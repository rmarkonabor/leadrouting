export interface WeightedCandidate {
  userId: string;
  assignmentWeight: number;
}

/**
 * Direct assignment (spec §29.1): the named user, if and only if they
 * survived eligibility filtering — an ineligible named user is not a
 * special case, it just yields no selection (the caller falls through to
 * fallback).
 */
export function selectDirect(
  namedUserId: string,
  eligibleUserIds: string[],
): string | null {
  return eligibleUserIds.includes(namedUserId) ? namedUserId : null;
}

/**
 * Team round robin (spec §29.2): eligible users in a fixed, stable order
 * (the caller passes them pre-sorted by `team_users.created_at`/`id`); picks
 * the next one strictly after `lastAssignedUserId` in that order, wrapping
 * around. If `lastAssignedUserId` is null or no longer eligible, starts
 * from the first eligible user. This is the exact algorithm the SQL
 * routing engine's locked cursor read must reproduce — see
 * docs/decisions.md for the locking discussion.
 */
export function selectRoundRobin(
  orderedEligibleUserIds: string[],
  lastAssignedUserId: string | null,
): string | null {
  if (orderedEligibleUserIds.length === 0) {
    return null;
  }

  if (lastAssignedUserId === null) {
    return orderedEligibleUserIds[0] ?? null;
  }

  const lastIndex = orderedEligibleUserIds.indexOf(lastAssignedUserId);
  if (lastIndex === -1) {
    return orderedEligibleUserIds[0] ?? null;
  }

  const nextIndex = (lastIndex + 1) % orderedEligibleUserIds.length;
  return orderedEligibleUserIds[nextIndex] ?? null;
}

/**
 * Weighted round robin (spec §29.3): builds a virtual sequence where each
 * eligible user appears `assignmentWeight` times (e.g. A:3, B:2, C:1 →
 * [A,A,A,B,B,C]), then walks it using `rotationCursor` as a strictly
 * increasing position counter (`cursor % sequence.length`). Capacity and
 * availability filtering must already have happened before this function
 * is ever called — it only sees already-eligible candidates, per spec
 * §29.3 "capacity and availability filters must run before user
 * selection."
 */
export function selectWeightedRoundRobin(
  eligibleCandidates: WeightedCandidate[],
  rotationCursor: number,
): string | null {
  const sequence: string[] = [];
  for (const candidate of eligibleCandidates) {
    for (let i = 0; i < Math.max(candidate.assignmentWeight, 0); i++) {
      sequence.push(candidate.userId);
    }
  }

  if (sequence.length === 0) {
    return null;
  }

  const position =
    ((rotationCursor % sequence.length) + sequence.length) % sequence.length;
  return sequence[position] ?? null;
}

export type FallbackOutcome =
  | { type: "fallback_user"; userId: string }
  | { type: "fallback_team_round_robin"; userId: string }
  | { type: "manual_review" };

/**
 * Fallback resolution (spec §29.4): tries a fallback user (subject to the
 * same eligibility filter, applied by the caller before this is invoked),
 * then a fallback team via round robin, then manual review. This function
 * only encodes the *order of attempts* given already-computed eligibility
 * results — it performs no filtering itself.
 */
export function resolveFallback(options: {
  fallbackUserId: string | null;
  fallbackUserEligible: boolean;
  fallbackTeamEligibleUserIds: string[] | null;
  fallbackTeamLastAssignedUserId: string | null;
}): FallbackOutcome {
  if (options.fallbackUserId && options.fallbackUserEligible) {
    return { type: "fallback_user", userId: options.fallbackUserId };
  }

  if (
    options.fallbackTeamEligibleUserIds &&
    options.fallbackTeamEligibleUserIds.length > 0
  ) {
    const selected = selectRoundRobin(
      options.fallbackTeamEligibleUserIds,
      options.fallbackTeamLastAssignedUserId,
    );
    if (selected) {
      return { type: "fallback_team_round_robin", userId: selected };
    }
  }

  return { type: "manual_review" };
}
