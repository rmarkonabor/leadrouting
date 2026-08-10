import { getRoutingHealth } from "@/modules/routing-health/routing-health";
import { toAppError } from "@/lib/errors/app-error";

const METRIC_LABELS: Record<string, string> = {
  leadsReceived: "Leads received",
  leadsAssigned: "Leads assigned",
  leadsAwaitingAcceptance: "Leads awaiting acceptance",
  assignmentsExpired: "Assignments expired",
  leadsReassigned: "Leads reassigned",
  leadsInManualReview: "Leads in manual review",
  noMatchingRuleCount: "No matching rule",
  noEligibleUserCount: "No eligible user",
  usersAtCapacityCount: "Users at capacity",
  unavailableUsersCount: "Unavailable users",
  territoriesWithoutUsersCount: "Territories without users",
  territoryConflictsCount: "Territory conflicts",
  crmSyncFailures: "CRM sync failures",
  webhookFailures: "Webhook failures",
  medianRoutingTimeMs: "Median routing time (ms)",
  medianAcceptanceTimeMs: "Median acceptance time (ms)",
  assignmentSuccessRate: "Assignment success rate",
  manualRoutingRate: "Manual routing rate",
};

export default async function RoutingHealthPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const bucketEnd = new Date();
  const bucketStart = new Date(bucketEnd.getTime() - 24 * 60 * 60 * 1000);

  const [metrics, loadError] = await getRoutingHealth(orgSlug, {
    bucketStart: bucketStart.toISOString(),
    bucketEnd: bucketEnd.toISOString(),
  }).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !metrics) {
    return (
      <main>
        <h1>Routing health</h1>
        <p role="alert">{loadError ?? "Something went wrong loading routing health."}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Routing health</h1>
      <p>
        Last 24 hours ({bucketStart.toISOString()} – {bucketEnd.toISOString()})
      </p>
      <dl>
        {Object.entries(METRIC_LABELS).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{String(metrics[key as keyof typeof metrics] ?? "—")}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
