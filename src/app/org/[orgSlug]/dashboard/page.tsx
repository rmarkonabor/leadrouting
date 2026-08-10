import Link from "next/link";
import { getDashboardSummary } from "@/modules/dashboard/dashboard";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Dashboard</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <ul>
        <li>
          <Link href={`/org/${orgSlug}/leads`}>Leads</Link> — {summary.leadsTotal} total,{" "}
          {summary.leadsAwaitingAcceptance} awaiting acceptance
        </li>
        {summary.manualReviewOpenCount !== null ? (
          <li>
            <Link href={`/org/${orgSlug}/manual-review`}>Manual review</Link> —{" "}
            {summary.manualReviewOpenCount} open
          </li>
        ) : null}
        <li>
          <Link href={`/org/${orgSlug}/notifications`}>Notifications</Link> —{" "}
          {summary.unreadNotificationsCount} unread
        </li>
        <li>
          <Link href={`/org/${orgSlug}/routing-health`}>Routing health</Link>
        </li>
        <li>
          <Link href={`/org/${orgSlug}/routing/simulator`}>Routing simulator</Link>
        </li>
      </ul>
    </main>
  );
}
