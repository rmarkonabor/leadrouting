import { EXCLUSION_CODES, type ExclusionCode } from "./exclusion-codes";
import { isWithinWorkingHours, type WorkingHoursConfig } from "./working-hours";

export interface RecipientRequirement {
  attributeDefinitionId: string;
  operator: "equals" | "not_equals" | "is_in" | "is_not_in" | "is_not_empty" | "is_empty";
  value?: unknown;
  values?: unknown[];
}

export interface CandidateUser {
  userId: string;
  isActive: boolean;
  availabilityStatus: "available" | "busy" | "away" | "vacation" | "offline";
  acceptLeads: boolean;
  timezone: string;
  workingHours: WorkingHoursConfig;
  dailyLeadLimit: number;
  activeLeadLimit: number;
  todayAssignedCount: number;
  activeAssignedCount: number;
  /** Territory ids this user is directly or team-linked to. */
  territoryIds: string[];
  recipientAttributeValues: Record<string, unknown>;
  isTeamMember: boolean;
  isTeamActive: boolean;
}

export interface EligibilityOptions {
  evaluatedAt: Date;
  /** Set when the rule's action requires a specific team. */
  requiredTeamMembership?: boolean;
  /** Active territory ids the lead's normalized location matches. */
  leadMatchedTerritoryIds: string[];
  /** Territories are only relevant if the rule/flow requires territory coverage. */
  requireTerritoryMatch: boolean;
  recipientRequirements: RecipientRequirement[];
  previouslyDeclinedUserIds: string[];
}

export interface ExcludedCandidate {
  userId: string;
  reasonCode: ExclusionCode;
}

export interface EligibilityResult {
  eligible: CandidateUser[];
  excluded: ExcludedCandidate[];
}

function satisfiesRequirement(
  value: unknown,
  requirement: RecipientRequirement,
): boolean {
  switch (requirement.operator) {
    case "equals":
      return value === requirement.value;
    case "not_equals":
      return value !== requirement.value;
    case "is_in":
      return (requirement.values ?? []).includes(value);
    case "is_not_in":
      return !(requirement.values ?? []).includes(value);
    case "is_not_empty":
      return value !== null && value !== undefined && value !== "";
    case "is_empty":
      return value === null || value === undefined || value === "";
  }
}

/**
 * Removes ineligible candidates in the fixed order defined by spec §30
 * steps 7-14 / docs/routing-engine.md §3, recording one stable exclusion
 * code per removed candidate — the first disqualifying reason wins, a
 * candidate is never excluded twice. Pure and deterministic given its
 * inputs; this is the specification the SQL routing engine's eligibility
 * logic (docs/decisions.md, this milestone's ADRs) is written to match.
 */
export function filterEligibleCandidates(
  candidates: CandidateUser[],
  options: EligibilityOptions,
): EligibilityResult {
  const eligible: CandidateUser[] = [];
  const excluded: ExcludedCandidate[] = [];

  for (const candidate of candidates) {
    if (options.requiredTeamMembership && !candidate.isTeamMember) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.NOT_IN_SELECTED_TEAM,
      });
      continue;
    }
    if (options.requiredTeamMembership && !candidate.isTeamActive) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.TEAM_INACTIVE,
      });
      continue;
    }
    if (!candidate.isActive) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.USER_INACTIVE,
      });
      continue;
    }
    if (candidate.availabilityStatus !== "available" || !candidate.acceptLeads) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.USER_UNAVAILABLE,
      });
      continue;
    }
    if (
      !isWithinWorkingHours(
        options.evaluatedAt,
        candidate.timezone,
        candidate.workingHours,
      )
    ) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.OUTSIDE_WORKING_HOURS,
      });
      continue;
    }
    if (
      candidate.dailyLeadLimit > 0 &&
      candidate.todayAssignedCount >= candidate.dailyLeadLimit
    ) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.DAILY_CAPACITY_REACHED,
      });
      continue;
    }
    if (
      candidate.activeLeadLimit > 0 &&
      candidate.activeAssignedCount >= candidate.activeLeadLimit
    ) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.ACTIVE_CAPACITY_REACHED,
      });
      continue;
    }
    if (options.requireTerritoryMatch) {
      const covers = candidate.territoryIds.some((id) =>
        options.leadMatchedTerritoryIds.includes(id),
      );
      if (!covers) {
        excluded.push({
          userId: candidate.userId,
          reasonCode: EXCLUSION_CODES.TERRITORY_NOT_MATCHED,
        });
        continue;
      }
    }
    const unmetRequirement = options.recipientRequirements.find(
      (req) =>
        !satisfiesRequirement(
          candidate.recipientAttributeValues[req.attributeDefinitionId],
          req,
        ),
    );
    if (unmetRequirement) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.RECIPIENT_ATTRIBUTE_NOT_MATCHED,
      });
      continue;
    }
    if (options.previouslyDeclinedUserIds.includes(candidate.userId)) {
      excluded.push({
        userId: candidate.userId,
        reasonCode: EXCLUSION_CODES.PREVIOUSLY_DECLINED,
      });
      continue;
    }

    eligible.push(candidate);
  }

  return { eligible, excluded };
}
