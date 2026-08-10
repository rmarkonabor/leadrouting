import { describe, expect, it } from "vitest";
import {
  filterEligibleCandidates,
  type CandidateUser,
  type EligibilityOptions,
} from "@/modules/routing/eligibility";
import { EXCLUSION_CODES } from "@/modules/routing/exclusion-codes";

function candidate(overrides: Partial<CandidateUser>): CandidateUser {
  return {
    userId: "user-1",
    isActive: true,
    availabilityStatus: "available",
    acceptLeads: true,
    timezone: "UTC",
    workingHours: { thursday: { start: "00:00", end: "23:59" } },
    dailyLeadLimit: 0,
    activeLeadLimit: 0,
    todayAssignedCount: 0,
    activeAssignedCount: 0,
    territoryIds: [],
    recipientAttributeValues: {},
    isTeamMember: true,
    isTeamActive: true,
    ...overrides,
  };
}

function options(overrides: Partial<EligibilityOptions> = {}): EligibilityOptions {
  return {
    evaluatedAt: new Date("2026-08-06T12:00:00Z"), // a Thursday
    requiredTeamMembership: false,
    leadMatchedTerritoryIds: [],
    requireTerritoryMatch: false,
    recipientRequirements: [],
    previouslyDeclinedUserIds: [],
    ...overrides,
  };
}

describe("filterEligibleCandidates", () => {
  it("keeps a fully eligible candidate", () => {
    const result = filterEligibleCandidates([candidate({})], options());
    expect(result.eligible.map((c) => c.userId)).toEqual(["user-1"]);
    expect(result.excluded).toEqual([]);
  });

  it("excludes a user not on the required team", () => {
    const result = filterEligibleCandidates(
      [candidate({ isTeamMember: false })],
      options({ requiredTeamMembership: true }),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.NOT_IN_SELECTED_TEAM },
    ]);
  });

  it("excludes an inactive user", () => {
    const result = filterEligibleCandidates([candidate({ isActive: false })], options());
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.USER_INACTIVE },
    ]);
  });

  it("excludes an unavailable user (availability status)", () => {
    const result = filterEligibleCandidates(
      [candidate({ availabilityStatus: "away" })],
      options(),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.USER_UNAVAILABLE },
    ]);
  });

  it("excludes a user who opted out of accepting leads", () => {
    const result = filterEligibleCandidates(
      [candidate({ acceptLeads: false })],
      options(),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.USER_UNAVAILABLE },
    ]);
  });

  it("excludes a user outside their working hours", () => {
    const result = filterEligibleCandidates(
      [candidate({ workingHours: { thursday: { start: "01:00", end: "02:00" } } })],
      options(),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.OUTSIDE_WORKING_HOURS },
    ]);
  });

  it("excludes a user at their daily capacity", () => {
    const result = filterEligibleCandidates(
      [candidate({ dailyLeadLimit: 3, todayAssignedCount: 3 })],
      options(),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.DAILY_CAPACITY_REACHED },
    ]);
  });

  it("excludes a user at their active capacity", () => {
    const result = filterEligibleCandidates(
      [candidate({ activeLeadLimit: 5, activeAssignedCount: 5 })],
      options(),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.ACTIVE_CAPACITY_REACHED },
    ]);
  });

  it("excludes a user whose territories don't cover the lead's location", () => {
    const result = filterEligibleCandidates(
      [candidate({ territoryIds: ["other-territory"] })],
      options({ requireTerritoryMatch: true, leadMatchedTerritoryIds: ["territory-1"] }),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.TERRITORY_NOT_MATCHED },
    ]);
  });

  it("keeps a user whose territories do cover the lead's location", () => {
    const result = filterEligibleCandidates(
      [candidate({ territoryIds: ["territory-1"] })],
      options({ requireTerritoryMatch: true, leadMatchedTerritoryIds: ["territory-1"] }),
    );
    expect(result.eligible).toHaveLength(1);
  });

  it("excludes a user missing a required recipient attribute", () => {
    const result = filterEligibleCandidates(
      [candidate({ recipientAttributeValues: { "attr-1": "spanish" } })],
      options({
        recipientRequirements: [
          { attributeDefinitionId: "attr-1", operator: "equals", value: "french" },
        ],
      }),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.RECIPIENT_ATTRIBUTE_NOT_MATCHED },
    ]);
  });

  it("excludes a user who previously declined this lead", () => {
    const result = filterEligibleCandidates(
      [candidate({})],
      options({ previouslyDeclinedUserIds: ["user-1"] }),
    );
    expect(result.excluded).toEqual([
      { userId: "user-1", reasonCode: EXCLUSION_CODES.PREVIOUSLY_DECLINED },
    ]);
  });

  it("applies exclusion reasons independently per candidate", () => {
    const result = filterEligibleCandidates(
      [candidate({ userId: "a", isActive: false }), candidate({ userId: "b" })],
      options(),
    );
    expect(result.eligible.map((c) => c.userId)).toEqual(["b"]);
    expect(result.excluded).toEqual([
      { userId: "a", reasonCode: EXCLUSION_CODES.USER_INACTIVE },
    ]);
  });
});
