import { describe, expect, it } from "vitest";
import {
  selectDirect,
  selectRoundRobin,
  selectWeightedRoundRobin,
  resolveFallback,
} from "@/modules/routing/assignment-algorithms";

describe("selectDirect", () => {
  it("selects the named user when eligible", () => {
    expect(selectDirect("user-1", ["user-1", "user-2"])).toBe("user-1");
  });

  it("returns null when the named user is not eligible", () => {
    expect(selectDirect("user-3", ["user-1", "user-2"])).toBeNull();
  });
});

describe("selectRoundRobin", () => {
  const order = ["a", "b", "c"];

  it("starts from the first user when there is no prior assignment", () => {
    expect(selectRoundRobin(order, null)).toBe("a");
  });

  it("selects the next user after the last assigned one, in order", () => {
    expect(selectRoundRobin(order, "a")).toBe("b");
    expect(selectRoundRobin(order, "b")).toBe("c");
  });

  it("wraps around to the first user after the last one", () => {
    expect(selectRoundRobin(order, "c")).toBe("a");
  });

  it("restarts from the first user if the last assigned user is no longer eligible", () => {
    expect(selectRoundRobin(order, "removed-user")).toBe("a");
  });

  it("returns null when there are no eligible users", () => {
    expect(selectRoundRobin([], "a")).toBeNull();
  });
});

describe("selectWeightedRoundRobin", () => {
  const candidates = [
    { userId: "A", assignmentWeight: 3 },
    { userId: "B", assignmentWeight: 2 },
    { userId: "C", assignmentWeight: 1 },
  ];

  it("distributes selections proportionally to weight over a full cycle", () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let cursor = 0; cursor < 6; cursor++) {
      const selected = selectWeightedRoundRobin(candidates, cursor);
      if (selected) counts[selected] = (counts[selected] ?? 0) + 1;
    }
    expect(counts).toEqual({ A: 3, B: 2, C: 1 });
  });

  it("is deterministic for the same cursor value", () => {
    expect(selectWeightedRoundRobin(candidates, 4)).toBe(
      selectWeightedRoundRobin(candidates, 4),
    );
  });

  it("returns null when there are no eligible candidates", () => {
    expect(selectWeightedRoundRobin([], 0)).toBeNull();
  });
});

describe("resolveFallback", () => {
  it("uses the fallback user when eligible", () => {
    const outcome = resolveFallback({
      fallbackUserId: "user-1",
      fallbackUserEligible: true,
      fallbackTeamEligibleUserIds: null,
      fallbackTeamLastAssignedUserId: null,
    });
    expect(outcome).toEqual({ type: "fallback_user", userId: "user-1" });
  });

  it("falls through to the fallback team when the fallback user is ineligible", () => {
    const outcome = resolveFallback({
      fallbackUserId: "user-1",
      fallbackUserEligible: false,
      fallbackTeamEligibleUserIds: ["user-2", "user-3"],
      fallbackTeamLastAssignedUserId: null,
    });
    expect(outcome).toEqual({ type: "fallback_team_round_robin", userId: "user-2" });
  });

  it("falls through to manual review when nothing is eligible", () => {
    const outcome = resolveFallback({
      fallbackUserId: null,
      fallbackUserEligible: false,
      fallbackTeamEligibleUserIds: [],
      fallbackTeamLastAssignedUserId: null,
    });
    expect(outcome).toEqual({ type: "manual_review" });
  });
});
