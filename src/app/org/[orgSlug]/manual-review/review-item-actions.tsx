"use client";

import {
  resolveManualReviewItemAction,
  dismissManualReviewItemAction,
} from "@/modules/manual-review/actions";

export function ReviewItemActions({
  orgSlug,
  itemId,
}: {
  orgSlug: string;
  itemId: string;
}) {
  const resolveAction = resolveManualReviewItemAction.bind(null, orgSlug, itemId);
  const dismissAction = dismissManualReviewItemAction.bind(null, orgSlug, itemId);

  return (
    <>
      <form action={resolveAction} style={{ display: "inline" }}>
        <button type="submit">Resolve</button>
      </form>{" "}
      <form action={dismissAction} style={{ display: "inline" }}>
        <button type="submit">Dismiss</button>
      </form>
    </>
  );
}
