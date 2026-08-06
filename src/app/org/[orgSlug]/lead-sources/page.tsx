import { listLeadSources } from "@/modules/lead-sources/lead-sources";
import { CreateLeadSourceForm } from "./create-lead-source-form";
import { toAppError } from "@/lib/errors/app-error";

export default async function LeadSourcesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [leadSources, loadError] = await listLeadSources(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !leadSources) {
    return (
      <main>
        <h1>Lead sources</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Lead sources</h1>
      <ul>
        {leadSources.map((source) => (
          <li key={source.id}>
            {source.name} — {source.source_type} — {source.status}
          </li>
        ))}
      </ul>

      <section>
        <h2>Create a lead source</h2>
        <CreateLeadSourceForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
