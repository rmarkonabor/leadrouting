export interface RoutingExplanationLike {
  routingFlowId: string | null;
  routingFlowVersionId: string | null;
  rulesEvaluated: Array<{
    ruleId: string;
    name: string;
    priority: number;
    passed: boolean;
  }>;
  matchedRuleId: string | null;
  territoryMatches: string[];
  eligibleUsers: string[];
  excludedUsers: Array<{ userId: string; reasonCode: string }>;
  assignmentAlgorithm: string | null;
  selectedUserId: string | null;
  fallbackResult: { type: string; userId?: string } | null;
  outcome: string;
  manualReviewReason?: string | null;
}

/**
 * Renders a human-readable explanation directly from the structured
 * routing result — never from a model (spec §33's explicit prohibition on
 * AI-generated routing explanations). Deterministic and pure: the same
 * structured result always renders the same text, which is what the
 * required "readable explanation matches structured result" test checks.
 */
export function formatRoutingExplanation(result: RoutingExplanationLike): string {
  const lines: string[] = [];

  if (!result.routingFlowId) {
    lines.push(
      "No active, published routing flow was found for this lead's organization.",
    );
  } else {
    lines.push(
      `Evaluated ${result.rulesEvaluated.length} rule(s) in flow version ${result.routingFlowVersionId}.`,
    );
    for (const rule of result.rulesEvaluated) {
      lines.push(
        `- Rule "${rule.name}" (priority ${rule.priority}): ${rule.passed ? "matched" : "did not match"}.`,
      );
    }
  }

  if (result.territoryMatches.length > 0) {
    lines.push(`Matched territories: ${result.territoryMatches.join(", ")}.`);
  }

  if (result.eligibleUsers.length > 0) {
    lines.push(`Eligible users: ${result.eligibleUsers.join(", ")}.`);
  }

  for (const excluded of result.excludedUsers) {
    lines.push(`Excluded user ${excluded.userId}: ${excluded.reasonCode}.`);
  }

  if (result.outcome === "assigned") {
    lines.push(
      `Assigned to user ${result.selectedUserId} via ${result.assignmentAlgorithm}${
        result.fallbackResult ? ` (${result.fallbackResult.type})` : ""
      }.`,
    );
  } else {
    lines.push(
      `Sent to manual review${result.manualReviewReason ? `: ${result.manualReviewReason}` : "."}`,
    );
  }

  return lines.join("\n");
}
