import { getRoutingFlow } from "@/modules/routing/routing-flows";
import { listRoutingRules } from "@/modules/routing/routing-rules";
import { listTeams } from "@/modules/teams/teams";
import { CreateRoutingRuleForm } from "./create-rule-form";
import { PublishFlowButton } from "./publish-flow-button";
import { DeleteRuleButton } from "./delete-rule-button";
import { toAppError } from "@/lib/errors/app-error";

export default async function RoutingFlowDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; flowId: string }>;
}) {
  const { orgSlug, flowId } = await params;

  const [data, loadError] = await Promise.all([
    getRoutingFlow(orgSlug, flowId),
    listRoutingRules(orgSlug, flowId),
    listTeams(orgSlug),
  ]).then(
    ([flow, rules, teams]) => [{ flow, rules, teams }, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !data) {
    return (
      <main>
        <h1>Routing flow</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  const { flow, rules, teams } = data;

  return (
    <main>
      <h1>{flow.name}</h1>
      <p>
        Status: {flow.status}
        {flow.current_version_id ? " (has a published version)" : " (never published)"}
      </p>

      <section>
        <h2>Draft rules</h2>
        <p>
          Rules run against the flow&apos;s <em>published</em> version once published —
          editing draft rules below never affects a lead already routed against an earlier
          version.
        </p>
        <ul>
          {rules.map((rule) => (
            <li key={rule.id}>
              [{rule.priority}] {rule.name} — action:{" "}
              {(rule.action as { type: string }).type}{" "}
              <DeleteRuleButton orgSlug={orgSlug} flowId={flowId} ruleId={rule.id} />
            </li>
          ))}
        </ul>

        <h3>Add a rule</h3>
        <CreateRoutingRuleForm orgSlug={orgSlug} flowId={flowId} teams={teams} />
      </section>

      <section>
        <h2>Publish</h2>
        <p>Publishing snapshots the rules above into a new, immutable version.</p>
        <PublishFlowButton orgSlug={orgSlug} flowId={flowId} />
      </section>
    </main>
  );
}
