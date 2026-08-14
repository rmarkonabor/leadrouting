import Link from "next/link";
import { listManualReviewItems } from "@/modules/manual-review/manual-review";
import { listTeams } from "@/modules/teams/teams";
import { ReviewItemActions } from "./review-item-actions";
import { ManualAssignForm } from "./manual-assign-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

export default async function ManualReviewPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [data, loadError] = await Promise.all([
    listManualReviewItems(orgSlug),
    listTeams(orgSlug),
  ]).then(
    ([items, teams]) => [{ items, teams }, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !data) {
    return (
      <PageContainer>
        <PageTitle>Manual review</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  const { items, teams } = data;
  const openItems = items.filter((item) => item.status === "open");

  return (
    <PageContainer>
      <PageTitle>Manual review</PageTitle>
      <div className="flex flex-col gap-4">
        {openItems.map((item) => (
          <Card key={item.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={`/org/${orgSlug}/leads/${item.lead_id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                Lead {item.lead_id}
              </Link>
              <StatusBadge status={item.reason} />
            </div>
            <ReviewItemActions orgSlug={orgSlug} itemId={item.id} />
            <ManualAssignForm orgSlug={orgSlug} leadId={item.lead_id} teams={teams} />
          </Card>
        ))}
        {openItems.length === 0 ? (
          <p className="text-sm text-muted">No open items.</p>
        ) : null}
      </div>
    </PageContainer>
  );
}
