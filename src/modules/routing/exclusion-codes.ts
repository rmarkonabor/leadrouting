/**
 * Stable exclusion reason codes (spec §33). These strings are stored in
 * `assignment_attempts.excluded` and in the SQL routing engine's structured
 * result — they must never be renamed once shipped, since historical
 * routing explanations reference them.
 */
export const EXCLUSION_CODES = {
  NOT_IN_SELECTED_TEAM: "NOT_IN_SELECTED_TEAM",
  TEAM_INACTIVE: "TEAM_INACTIVE",
  USER_INACTIVE: "USER_INACTIVE",
  USER_UNAVAILABLE: "USER_UNAVAILABLE",
  OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
  DAILY_CAPACITY_REACHED: "DAILY_CAPACITY_REACHED",
  ACTIVE_CAPACITY_REACHED: "ACTIVE_CAPACITY_REACHED",
  TERRITORY_NOT_MATCHED: "TERRITORY_NOT_MATCHED",
  TERRITORY_INACTIVE: "TERRITORY_INACTIVE",
  RECIPIENT_ATTRIBUTE_NOT_MATCHED: "RECIPIENT_ATTRIBUTE_NOT_MATCHED",
  PREVIOUSLY_DECLINED: "PREVIOUSLY_DECLINED",
} as const;

export type ExclusionCode = (typeof EXCLUSION_CODES)[keyof typeof EXCLUSION_CODES];
