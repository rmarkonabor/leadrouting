import Link from "next/link";
import { listRoutingFlows } from "@/modules/routing/routing-flows";
import { CreateRoutingFlowForm } from "./create-flow-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Routing</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Routing</h1>
      <p>
        <Link href={`/org/${orgSlug}/routing/simulator`}>Open the routing simulator</Link>
      </p>
      <ul>
        {flows.map((flow) => (
          <li key={flow.id}>
            <Link href={`/org/${orgSlug}/routing/${flow.id}`}>{flow.name}</Link> —{" "}
            {flow.status}
          </li>
        ))}
      </ul>

      <section>
        <h2>Create a routing flow</h2>
        <CreateRoutingFlowForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
