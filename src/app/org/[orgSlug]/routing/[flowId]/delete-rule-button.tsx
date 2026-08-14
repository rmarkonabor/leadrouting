"use client";

import { deleteRoutingRuleAction } from "@/modules/routing/actions";
import { Button } from "@/components/Button";

export function DeleteRuleButton({
  orgSlug,
  flowId,
  ruleId,
}: {
  orgSlug: string;
  flowId: string;
  ruleId: string;
}) {
  const boundAction = deleteRoutingRuleAction.bind(null, orgSlug, flowId, ruleId);

  return (
    <form action={boundAction}>
      <Button type="submit" variant="danger" className="px-2 py-0.5 text-xs">
        Delete
      </Button>
    </form>
  );
}
