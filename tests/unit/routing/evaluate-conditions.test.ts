import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  evaluateRuleConditions,
  type LeadEvaluationContext,
  type RoutingCondition,
} from "@/modules/routing/evaluate-conditions";

function context(
  fields: Record<string, unknown> = {},
  overrides: Partial<LeadEvaluationContext> = {},
): LeadEvaluationContext {
  return { fields, matchedTerritoryIds: [], ...overrides };
}

describe("evaluateCondition — text operators", () => {
  it("equals is case-insensitive", () => {
    const result = evaluateCondition(context({ city: "Toronto" }), {
      source: "default_field",
      field: "city",
      operator: "equals",
      value: "toronto",
    });
    expect(result.passed).toBe(true);
  });

  it("contains / not_contains", () => {
    const c = context({ message: "I need a quote soon" });
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "message",
        operator: "contains",
        value: "quote",
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "message",
        operator: "not_contains",
        value: "quote",
      }).passed,
    ).toBe(false);
  });

  it("is_in / is_not_in", () => {
    const c = context({ campaign: "spring_promo" });
    const cond: RoutingCondition = {
      source: "default_field",
      field: "campaign",
      operator: "is_in",
      values: ["spring_promo", "fall_promo"],
    };
    expect(evaluateCondition(c, cond).passed).toBe(true);
    expect(evaluateCondition(c, { ...cond, operator: "is_not_in" }).passed).toBe(false);
  });

  it("is_empty / is_not_empty", () => {
    const c = context({ referrer: "" });
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "referrer",
        operator: "is_empty",
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "referrer",
        operator: "is_not_empty",
      }).passed,
    ).toBe(false);
  });
});

describe("evaluateCondition — number operators (custom variable)", () => {
  it("greater_than / less_than_or_equal", () => {
    const c = context({ estimated_budget: 900_000 });
    expect(
      evaluateCondition(c, {
        source: "custom_variable",
        field: "estimated_budget",
        operator: "greater_than",
        value: 500_000,
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "custom_variable",
        field: "estimated_budget",
        operator: "less_than_or_equal",
        value: 500_000,
      }).passed,
    ).toBe(false);
  });

  it("treats a missing numeric field as failing a comparison", () => {
    const c = context({});
    expect(
      evaluateCondition(c, {
        source: "custom_variable",
        field: "estimated_budget",
        operator: "greater_than",
        value: 100,
      }).passed,
    ).toBe(false);
  });
});

describe("evaluateCondition — boolean and geographic", () => {
  it("is_true / is_false", () => {
    const c = context({ email_consent: true });
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "email_consent",
        operator: "is_true",
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "default_field",
        field: "email_consent",
        operator: "is_false",
      }).passed,
    ).toBe(false);
  });

  it("matches_territory checks the precomputed matched-territory list", () => {
    const c = context({}, { matchedTerritoryIds: ["territory-1"] });
    expect(
      evaluateCondition(c, {
        source: "territory",
        operator: "matches_territory",
        value: "territory-1",
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "territory",
        operator: "matches_territory",
        value: "territory-2",
      }).passed,
    ).toBe(false);
  });

  it("within_radius uses the lead's geocoded coordinates", () => {
    const c = context(
      {},
      { matchedTerritoryIds: [], location: { latitude: 43.66, longitude: -79.39 } },
    );
    expect(
      evaluateCondition(c, {
        source: "territory",
        operator: "within_radius",
        value: { latitude: 43.6532, longitude: -79.3832, radiusMeters: 10_000 },
      }).passed,
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        source: "territory",
        operator: "within_radius",
        value: { latitude: 43.6532, longitude: -79.3832, radiusMeters: 10 },
      }).passed,
    ).toBe(false);
  });
});

describe("evaluateRuleConditions — match_all / match_any", () => {
  const c = context({ city: "Toronto", country: "Canada" });
  const cityCond: RoutingCondition = {
    source: "default_field",
    field: "city",
    operator: "equals",
    value: "Toronto",
  };
  const wrongCountryCond: RoutingCondition = {
    source: "default_field",
    field: "country",
    operator: "equals",
    value: "USA",
  };

  it("match_all requires every condition to pass", () => {
    expect(evaluateRuleConditions(c, [cityCond], "match_all").passed).toBe(true);
    expect(
      evaluateRuleConditions(c, [cityCond, wrongCountryCond], "match_all").passed,
    ).toBe(false);
  });

  it("match_any requires only one condition to pass", () => {
    expect(
      evaluateRuleConditions(c, [cityCond, wrongCountryCond], "match_any").passed,
    ).toBe(true);
    expect(evaluateRuleConditions(c, [wrongCountryCond], "match_any").passed).toBe(false);
  });

  it("an empty condition list matches unconditionally", () => {
    expect(evaluateRuleConditions(c, [], "match_all").passed).toBe(true);
  });
});
