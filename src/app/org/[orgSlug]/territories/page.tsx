import Link from "next/link";
import { listTerritories } from "@/modules/territories/territories";
import { CreateTerritoryForm } from "./create-territory-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

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
      <PageContainer>
        <PageTitle>Territories</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <PageTitle>Territories</PageTitle>
        <Link
          href={`/org/${orgSlug}/territories/conflicts`}
          className="text-sm text-brand-600 hover:underline"
        >
          View conflict warnings
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {territories.map((territory) => (
          <Card key={territory.id} className="flex items-center justify-between">
            <span className="text-sm">
              {territory.name} — {territory.territory_type} — priority{" "}
              {territory.priority}
            </span>
            <StatusBadge status={territory.status} />
          </Card>
        ))}
        {territories.length === 0 ? (
          <p className="text-sm text-muted">No territories yet.</p>
        ) : null}
      </div>

      <Section title="Create a territory">
        <CreateTerritoryForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
