import { getRoutingHealth } from "@/modules/routing-health/routing-health";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { StatTile } from "@/components/Card";

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
      <PageContainer>
        <PageTitle>Routing health</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError ?? "Something went wrong loading routing health."}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Routing health</PageTitle>
      <p className="text-sm text-muted">
        Last 24 hours ({bucketStart.toISOString()} – {bucketEnd.toISOString()})
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Object.entries(METRIC_LABELS).map(([key, label]) => (
          <StatTile
            key={key}
            label={label}
            value={String(metrics[key as keyof typeof metrics] ?? "—")}
          />
        ))}
      </div>
    </PageContainer>
  );
}
