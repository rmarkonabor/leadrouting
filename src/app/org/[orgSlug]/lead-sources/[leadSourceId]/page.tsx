import { getLeadSource } from "@/modules/lead-sources/lead-sources";
import { listFieldMappings } from "@/modules/field-mapping/field-mappings";
import { FieldMappingForm } from "./field-mapping-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

export default async function LeadSourceDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; leadSourceId: string }>;
}) {
  const { orgSlug, leadSourceId } = await params;

  const [result, loadError] = await Promise.all([
    getLeadSource(orgSlug, leadSourceId),
    listFieldMappings(orgSlug, leadSourceId),
  ]).then(
    ([leadSource, mappings]) => [{ leadSource, mappings }, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !result) {
    return (
      <PageContainer>
        <PageTitle>Lead source</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>{result.leadSource.name}</PageTitle>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{result.leadSource.source_type}</span>
        <StatusBadge status={result.leadSource.status} />
      </div>

      <Section title="Field mappings">
        <div className="flex flex-col gap-2">
          {result.mappings.map((mapping) => (
            <Card key={mapping.id} className="text-sm">
              {mapping.source_field_name} → {mapping.destination_type}
              {mapping.destination_field ? ` (${mapping.destination_field})` : ""}
              {mapping.transformation ? ` [${mapping.transformation}]` : ""}
            </Card>
          ))}
          {result.mappings.length === 0 ? (
            <p className="text-sm text-muted">No mappings yet.</p>
          ) : null}
        </div>

        <p className="text-sm font-medium">Add or update a mapping</p>
        <FieldMappingForm orgSlug={orgSlug} leadSourceId={leadSourceId} />
      </Section>
    </PageContainer>
  );
}
