import Link from "next/link";
import { getDashboardSummary } from "@/modules/dashboard/dashboard";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { StatTile } from "@/components/Card";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [summary, loadError] = await getDashboardSummary(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !summary) {
    return (
      <PageContainer>
        <PageTitle>Dashboard</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Dashboard</PageTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Link href={`/org/${orgSlug}/leads`}>
          <StatTile label="Leads" value={summary.leadsTotal} />
        </Link>
        <Link href={`/org/${orgSlug}/leads?assignmentStatus=pending`}>
          <StatTile label="Awaiting acceptance" value={summary.leadsAwaitingAcceptance} />
        </Link>
        {summary.manualReviewOpenCount !== null ? (
          <Link href={`/org/${orgSlug}/manual-review`}>
            <StatTile
              label="Manual review (open)"
              value={summary.manualReviewOpenCount}
            />
          </Link>
        ) : null}
        <Link href={`/org/${orgSlug}/notifications`}>
          <StatTile
            label="Unread notifications"
            value={summary.unreadNotificationsCount}
          />
        </Link>
        <Link href={`/org/${orgSlug}/routing-health`}>
          <StatTile label="Routing health" value="View" />
        </Link>
        <Link href={`/org/${orgSlug}/routing/simulator`}>
          <StatTile label="Routing simulator" value="Open" />
        </Link>
      </div>
    </PageContainer>
  );
}
