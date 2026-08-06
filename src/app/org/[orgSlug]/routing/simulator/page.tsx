import { SimulatorForm } from "./simulator-form";

export default async function RoutingSimulatorPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <main>
      <h1>Routing simulator</h1>
      <p>
        Enter an existing lead&apos;s ID to preview the routing decision that would be
        made for it, without creating an assignment, sending a notification, or changing
        round-robin state (spec §34).
      </p>
      <SimulatorForm orgSlug={orgSlug} />
    </main>
  );
}
