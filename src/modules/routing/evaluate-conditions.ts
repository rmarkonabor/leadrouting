import { haversineDistanceMeters } from "@/modules/territories/match-territories";

export type ConditionSource = "default_field" | "custom_variable" | "territory";

export type TextOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "is_in"
  | "is_not_in";

export type NumberOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty";

export type DateOperator =
  | "equals"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "is_empty"
  | "is_not_empty";

export type BooleanOperator = "is_true" | "is_false";

export type GeographicOperator = "matches_territory" | "within_radius";

export type ConditionOperator =
  TextOperator | NumberOperator | DateOperator | BooleanOperator | GeographicOperator;

export interface RoutingCondition {
  source: ConditionSource;
  /** Default-field name or custom-variable internal_key. Unused for "territory". */
  field?: string;
  operator: ConditionOperator;
  value?: unknown;
  /** Used by is_in/is_not_in. */
  values?: unknown[];
}

export interface LeadEvaluationContext {
  /** Default lead fields + custom variable values, keyed by field name / internal_key. */
  fields: Record<string, unknown>;
  /** IDs of every active territory the lead's normalized location matches. */
  matchedTerritoryIds: string[];
  /** The lead's normalized coordinates, if geocoded — used by within_radius. */
  location?: { latitude: number | null; longitude: number | null };
}

export interface ConditionResult {
  condition: RoutingCondition;
  passed: boolean;
  actualValue?: unknown;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function evaluateTextOperator(
  operator: TextOperator,
  actual: unknown,
  condition: RoutingCondition,
): boolean {
  const a = typeof actual === "string" ? actual : actual == null ? "" : String(actual);
  const v =
    typeof condition.value === "string" ? condition.value : String(condition.value ?? "");

  switch (operator) {
    case "equals":
      return a.toLowerCase() === v.toLowerCase();
    case "not_equals":
      return a.toLowerCase() !== v.toLowerCase();
    case "contains":
      return a.toLowerCase().includes(v.toLowerCase());
    case "not_contains":
      return !a.toLowerCase().includes(v.toLowerCase());
    case "starts_with":
      return a.toLowerCase().startsWith(v.toLowerCase());
    case "ends_with":
      return a.toLowerCase().endsWith(v.toLowerCase());
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "is_in":
      return (condition.values ?? []).some(
        (candidate) => String(candidate).toLowerCase() === a.toLowerCase(),
      );
    case "is_not_in":
      return !(condition.values ?? []).some(
        (candidate) => String(candidate).toLowerCase() === a.toLowerCase(),
      );
  }
}

function evaluateNumberOperatorWithValue(
  operator: Exclude<NumberOperator, "is_empty" | "is_not_empty">,
  actual: number,
  value: number,
): boolean {
  switch (operator) {
    case "equals":
      return actual === value;
    case "not_equals":
      return actual !== value;
    case "greater_than":
      return actual > value;
    case "less_than":
      return actual < value;
    case "greater_than_or_equal":
      return actual >= value;
    case "less_than_or_equal":
      return actual <= value;
  }
}

function evaluateDateOperator(
  operator: Exclude<DateOperator, "is_empty" | "is_not_empty">,
  actual: number,
  value: number,
): boolean {
  switch (operator) {
    case "equals":
      return actual === value;
    case "before":
      return actual < value;
    case "after":
      return actual > value;
    case "on_or_before":
      return actual <= value;
    case "on_or_after":
      return actual >= value;
  }
}

function evaluateGeographic(
  operator: GeographicOperator,
  condition: RoutingCondition,
  context: LeadEvaluationContext,
): boolean {
  if (operator === "matches_territory") {
    return context.matchedTerritoryIds.includes(String(condition.value));
  }

  // within_radius: condition.value = { latitude, longitude, radiusMeters },
  // an ad-hoc radius independent of any stored territory row.
  const target = condition.value as
    { latitude?: number; longitude?: number; radiusMeters?: number } | undefined;
  if (
    !target ||
    target.latitude == null ||
    target.longitude == null ||
    target.radiusMeters == null ||
    context.location?.latitude == null ||
    context.location?.longitude == null
  ) {
    return false;
  }

  return (
    haversineDistanceMeters(
      context.location.latitude,
      context.location.longitude,
      target.latitude,
      target.longitude,
    ) <= target.radiusMeters
  );
}

/**
 * Evaluates one condition (spec §27's four operator families plus the two
 * geographic operators) against a lead's flattened evaluation context. Pure
 * and deterministic — no I/O, no clock reads beyond what's already baked
 * into `actual`/`value` — this is the "specification" the SQL routing
 * engine (docs/decisions.md, this milestone's ADRs) must match, and what
 * the required unit tests exercise directly without a database.
 */
export function evaluateCondition(
  context: LeadEvaluationContext,
  condition: RoutingCondition,
): ConditionResult {
  if (condition.source === "territory") {
    return {
      condition,
      passed: evaluateGeographic(
        condition.operator as GeographicOperator,
        condition,
        context,
      ),
    };
  }

  const actual = condition.field ? context.fields[condition.field] : undefined;

  if (condition.operator === "is_true" || condition.operator === "is_false") {
    const boolValue = actual === true;
    return {
      condition,
      passed: condition.operator === "is_true" ? boolValue : !boolValue,
      actualValue: actual,
    };
  }

  if (condition.operator === "is_empty" || condition.operator === "is_not_empty") {
    const empty = isEmpty(actual);
    return {
      condition,
      passed: condition.operator === "is_empty" ? empty : !empty,
      actualValue: actual,
    };
  }

  if (typeof actual === "number" || typeof condition.value === "number") {
    if (isEmpty(actual)) {
      return { condition, passed: false, actualValue: actual };
    }
    const numericOps: readonly string[] = [
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "greater_than_or_equal",
      "less_than_or_equal",
    ];
    if (numericOps.includes(condition.operator)) {
      return {
        condition,
        passed: evaluateNumberOperatorWithValue(
          condition.operator as Exclude<NumberOperator, "is_empty" | "is_not_empty">,
          Number(actual),
          Number(condition.value),
        ),
        actualValue: actual,
      };
    }
  }

  if (actual instanceof Date || condition.value instanceof Date) {
    const dateOps: readonly string[] = [
      "equals",
      "before",
      "after",
      "on_or_before",
      "on_or_after",
    ];
    if (dateOps.includes(condition.operator)) {
      const actualTime =
        actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
      const valueTime =
        condition.value instanceof Date
          ? condition.value.getTime()
          : Date.parse(String(condition.value));
      return {
        condition,
        passed: evaluateDateOperator(
          condition.operator as Exclude<DateOperator, "is_empty" | "is_not_empty">,
          actualTime,
          valueTime,
        ),
        actualValue: actual,
      };
    }
  }

  return {
    condition,
    passed: evaluateTextOperator(condition.operator as TextOperator, actual, condition),
    actualValue: actual,
  };
}

export interface RuleEvaluationResult {
  passed: boolean;
  results: ConditionResult[];
}

/**
 * Evaluates every condition in a rule and combines them per `match_type`
 * (spec §26: match_all / match_any). An empty condition list matches
 * everything (an unconditional rule), consistent with "match_all of zero
 * conditions is vacuously true."
 */
export function evaluateRuleConditions(
  context: LeadEvaluationContext,
  conditions: RoutingCondition[],
  matchType: "match_all" | "match_any",
): RuleEvaluationResult {
  const results = conditions.map((condition) => evaluateCondition(context, condition));

  const passed =
    conditions.length === 0
      ? true
      : matchType === "match_all"
        ? results.every((r) => r.passed)
        : results.some((r) => r.passed);

  return { passed, results };
}
