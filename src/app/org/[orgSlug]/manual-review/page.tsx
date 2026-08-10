import { listManualReviewItems } from "@/modules/manual-review/manual-review";
import { listTeams } from "@/modules/teams/teams";
import { ReviewItemActions } from "./review-item-actions";
import { ManualAssignForm } from "./manual-assign-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Manual review</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  const { items, teams } = data;
  const openItems = items.filter((item) => item.status === "open");

  return (
    <main>
      <h1>Manual review</h1>
      <ul>
        {openItems.map((item) => (
          <li key={item.id}>
            <p>
              Lead {item.lead_id} — reason: {item.reason}
            </p>
            <ReviewItemActions orgSlug={orgSlug} itemId={item.id} />
            <ManualAssignForm orgSlug={orgSlug} leadId={item.lead_id} teams={teams} />
          </li>
        ))}
        {openItems.length === 0 ? <li>No open items.</li> : null}
      </ul>
    </main>
  );
}
