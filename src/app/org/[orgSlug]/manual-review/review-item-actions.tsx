"use client";

import {
  resolveManualReviewItemAction,
  dismissManualReviewItemAction,
} from "@/modules/manual-review/actions";
import { Button } from "@/components/Button";

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
    <div className="flex gap-2">
      <form action={resolveAction}>
        <Button type="submit" variant="secondary">
          Resolve
        </Button>
      </form>
      <form action={dismissAction}>
        <Button type="submit" variant="danger">
          Dismiss
        </Button>
      </form>
    </div>
  );
}
