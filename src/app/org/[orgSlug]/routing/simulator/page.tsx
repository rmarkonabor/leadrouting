import { SimulatorForm } from "./simulator-form";
import { PageContainer, PageTitle } from "@/components/PageContainer";

export default async function RoutingSimulatorPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <PageContainer>
      <PageTitle>Routing simulator</PageTitle>
      <p className="text-sm text-muted">
        Enter an existing lead&apos;s ID to preview the routing decision that would be
        made for it, without creating an assignment, sending a notification, or changing
        round-robin state (spec §34).
      </p>
      <SimulatorForm orgSlug={orgSlug} />
    </PageContainer>
  );
}
