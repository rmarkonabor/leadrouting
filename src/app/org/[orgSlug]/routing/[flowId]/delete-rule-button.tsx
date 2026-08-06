"use client";

import { deleteRoutingRuleAction } from "@/modules/routing/actions";

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
    <form action={boundAction} style={{ display: "inline" }}>
      <button type="submit">Delete</button>
    </form>
  );
}
