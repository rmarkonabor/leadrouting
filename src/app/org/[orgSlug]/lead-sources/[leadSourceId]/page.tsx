import { getLeadSource } from "@/modules/lead-sources/lead-sources";
import { listFieldMappings } from "@/modules/field-mapping/field-mappings";
import { FieldMappingForm } from "./field-mapping-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Lead source</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{result.leadSource.name}</h1>
      <p>
        Type: {result.leadSource.source_type} — Status: {result.leadSource.status}
      </p>

      <h2>Field mappings</h2>
      <ul>
        {result.mappings.map((mapping) => (
          <li key={mapping.id}>
            {mapping.source_field_name} → {mapping.destination_type}
            {mapping.destination_field ? ` (${mapping.destination_field})` : ""}
            {mapping.transformation ? ` [${mapping.transformation}]` : ""}
          </li>
        ))}
      </ul>

      <section>
        <h3>Add or update a mapping</h3>
        <FieldMappingForm orgSlug={orgSlug} leadSourceId={leadSourceId} />
      </section>
    </main>
  );
}
