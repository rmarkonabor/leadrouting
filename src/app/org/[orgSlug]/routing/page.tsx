import Link from "next/link";
import { listRoutingFlows } from "@/modules/routing/routing-flows";
import { CreateRoutingFlowForm } from "./create-flow-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

export default async function RoutingFlowsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [flows, loadError] = await listRoutingFlows(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !flows) {
    return (
      <PageContainer>
        <PageTitle>Routing</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <PageTitle>Routing</PageTitle>
        <Link
          href={`/org/${orgSlug}/routing/simulator`}
          className="text-sm text-brand-600 hover:underline"
        >
          Open the routing simulator
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {flows.map((flow) => (
          <Card key={flow.id} className="flex items-center justify-between">
            <Link
              href={`/org/${orgSlug}/routing/${flow.id}`}
              className="font-medium text-brand-600 hover:underline"
            >
              {flow.name}
            </Link>
            <StatusBadge status={flow.status} />
          </Card>
        ))}
        {flows.length === 0 ? (
          <p className="text-sm text-muted">No routing flows yet.</p>
        ) : null}
      </div>

      <Section title="Create a routing flow">
        <CreateRoutingFlowForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
