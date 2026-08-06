import Link from "next/link";
import { listTerritories } from "@/modules/territories/territories";
import { CreateTerritoryForm } from "./create-territory-form";
import { toAppError } from "@/lib/errors/app-error";

export default async function TerritoriesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [territories, loadError] = await listTerritories(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !territories) {
    return (
      <main>
        <h1>Territories</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Territories</h1>
      <p>
        <Link href={`/org/${orgSlug}/territories/conflicts`}>View conflict warnings</Link>
      </p>
      <ul>
        {territories.map((territory) => (
          <li key={territory.id}>
            {territory.name} — {territory.territory_type} — priority {territory.priority}{" "}
            — {territory.status}
          </li>
        ))}
      </ul>

      <section>
        <h2>Create a territory</h2>
        <CreateTerritoryForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
