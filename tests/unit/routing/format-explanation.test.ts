import { describe, expect, it } from "vitest";
import {
  formatRoutingExplanation,
  type RoutingExplanationLike,
} from "@/modules/routing/format-explanation";

function result(overrides: Partial<RoutingExplanationLike>): RoutingExplanationLike {
  return {
    routingFlowId: "flow-1",
    routingFlowVersionId: "version-1",
    rulesEvaluated: [],
    matchedRuleId: null,
    territoryMatches: [],
    eligibleUsers: [],
    excludedUsers: [],
    assignmentAlgorithm: null,
    selectedUserId: null,
    fallbackResult: null,
    outcome: "manual_review",
    manualReviewReason: null,
    ...overrides,
  };
}

describe("formatRoutingExplanation", () => {
  it("describes an assigned outcome, mentioning the selected user and algorithm", () => {
    const text = formatRoutingExplanation(
      result({
        outcome: "assigned",
        selectedUserId: "user-1",
        assignmentAlgorithm: "round_robin",
        eligibleUsers: ["user-1", "user-2"],
      }),
    );
    expect(text).toContain("Assigned to user user-1 via round_robin");
    expect(text).toContain("Eligible users: user-1, user-2");
  });

  it("describes a manual review outcome with its reason", () => {
    const text = formatRoutingExplanation(
      result({ outcome: "manual_review", manualReviewReason: "no_eligible_user" }),
    );
    expect(text).toContain("Sent to manual review: no_eligible_user");
  });

  it("includes every evaluated rule and exclusion reason so the text matches the structured result", () => {
    const text = formatRoutingExplanation(
      result({
        rulesEvaluated: [
          { ruleId: "r1", name: "Rule A", priority: 10, passed: false },
          { ruleId: "r2", name: "Rule B", priority: 20, passed: true },
        ],
        excludedUsers: [{ userId: "user-3", reasonCode: "USER_INACTIVE" }],
      }),
    );
    expect(text).toContain('Rule "Rule A" (priority 10): did not match');
    expect(text).toContain('Rule "Rule B" (priority 20): matched');
    expect(text).toContain("Excluded user user-3: USER_INACTIVE");
  });

  it("mentions matched territories when present", () => {
    const text = formatRoutingExplanation(result({ territoryMatches: ["territory-1"] }));
    expect(text).toContain("Matched territories: territory-1");
  });

  it("reports no flow found when routingFlowId is null", () => {
    const text = formatRoutingExplanation(
      result({ routingFlowId: null, routingFlowVersionId: null }),
    );
    expect(text).toContain("No active, published routing flow was found");
  });
});
