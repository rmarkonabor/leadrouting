import type { RoutingExplanationLike } from "@/modules/routing/format-explanation";
import { Badge, StatusBadge } from "@/components/Badge";
import { Card } from "@/components/Card";

const OUTCOME_LABEL: Record<string, string> = {
  assigned: "Assigned",
  manual_review: "Sent to manual review",
  already_assigned: "Already assigned",
};

/**
 * Renders a routing decision (route_lead / simulate_routing's structured
 * result) as readable UI instead of raw JSON — every field this shows was
 * already computed server-side; this only changes how it's displayed. Used
 * by both the routing simulator and a lead's assignment explanation, since
 * both surface the same structured shape (`RoutingExplanationLike`).
 */
export function RoutingResultView({ result }: { result: RoutingExplanationLike }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted">Outcome</span>
        <StatusBadge status={result.outcome} />
        <span className="text-sm">{OUTCOME_LABEL[result.outcome] ?? result.outcome}</span>
      </div>

      {!result.routingFlowId ? (
        <p className="text-sm text-muted">
          No active, published routing flow was found for this organization.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">Rules evaluated</span>
          <ul className="flex flex-col gap-1">
            {result.rulesEvaluated.map((rule) => (
              <li
                key={rule.ruleId}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                  rule.ruleId === result.matchedRuleId
                    ? "border-brand-500 bg-brand-50"
                    : "border-border"
                }`}
              >
                <Badge variant={rule.passed ? "success" : "neutral"}>
                  {rule.passed ? "matched" : "no match"}
                </Badge>
                <span>
                  {rule.name} (priority {rule.priority})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.territoryMatches.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted">Matched territories</span>
          <div className="flex flex-wrap gap-1">
            {result.territoryMatches.map((t) => (
              <Badge key={t} variant="info">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {result.eligibleUsers.length > 0 || result.excludedUsers.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {result.eligibleUsers.length > 0 ? (
            <Card>
              <p className="mb-2 text-sm font-medium text-muted">
                Eligible users ({result.eligibleUsers.length})
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {result.eligibleUsers.map((userId) => (
                  <li key={userId} className="flex items-center gap-2">
                    <Badge variant="success">eligible</Badge>
                    <span className="truncate">{userId}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {result.excludedUsers.length > 0 ? (
            <Card>
              <p className="mb-2 text-sm font-medium text-muted">
                Excluded users ({result.excludedUsers.length})
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {result.excludedUsers.map((excluded) => (
                  <li key={excluded.userId} className="flex items-center gap-2">
                    <Badge variant="danger">
                      {excluded.reasonCode.replace(/_/g, " ")}
                    </Badge>
                    <span className="truncate">{excluded.userId}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      {result.outcome === "assigned" ? (
        <p className="text-sm">
          Assigned to <span className="font-medium">{result.selectedUserId}</span> via{" "}
          <Badge variant="info">{result.assignmentAlgorithm}</Badge>
          {result.fallbackResult ? ` (${result.fallbackResult.type})` : ""}
        </p>
      ) : result.manualReviewReason ? (
        <p className="text-sm">
          Reason: <StatusBadge status={result.manualReviewReason} />
        </p>
      ) : null}
    </div>
  );
}
