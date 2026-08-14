import { getRoutingFlow } from "@/modules/routing/routing-flows";
import { listRoutingRules } from "@/modules/routing/routing-rules";
import { listTeams } from "@/modules/teams/teams";
import { CreateRoutingRuleForm } from "./create-rule-form";
import { PublishFlowButton } from "./publish-flow-button";
import { DeleteRuleButton } from "./delete-rule-button";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

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
      <PageContainer>
        <PageTitle>Routing flow</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  const { flow, rules, teams } = data;

  return (
    <PageContainer>
      <PageTitle>{flow.name}</PageTitle>
      <div className="flex items-center gap-2 text-sm">
        <StatusBadge status={flow.status} />
        <span className="text-muted">
          {flow.current_version_id ? "has a published version" : "never published"}
        </span>
      </div>

      <Section title="Draft rules">
        <p className="text-sm text-muted">
          Rules run against the flow&apos;s <em>published</em> version once published —
          editing draft rules below never affects a lead already routed against an earlier
          version.
        </p>
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <Card key={rule.id} className="flex items-center justify-between">
              <span className="text-sm">
                [{rule.priority}] {rule.name} — action:{" "}
                {(rule.action as { type: string }).type}
              </span>
              <DeleteRuleButton orgSlug={orgSlug} flowId={flowId} ruleId={rule.id} />
            </Card>
          ))}
          {rules.length === 0 ? (
            <p className="text-sm text-muted">No rules yet.</p>
          ) : null}
        </div>

        <p className="mt-2 text-sm font-medium">Add a rule</p>
        <CreateRoutingRuleForm orgSlug={orgSlug} flowId={flowId} teams={teams} />
      </Section>

      <Section title="Publish">
        <p className="text-sm text-muted">
          Publishing snapshots the rules above into a new, immutable version.
        </p>
        <PublishFlowButton orgSlug={orgSlug} flowId={flowId} />
      </Section>
    </PageContainer>
  );
}
