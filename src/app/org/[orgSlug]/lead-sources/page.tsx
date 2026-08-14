import Link from "next/link";
import { listLeadSources } from "@/modules/lead-sources/lead-sources";
import { CreateLeadSourceForm } from "./create-lead-source-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

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
      <PageContainer>
        <PageTitle>Lead sources</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Lead sources</PageTitle>
      <div className="flex flex-col gap-2">
        {leadSources.map((source) => (
          <Card key={source.id} className="flex items-center justify-between">
            <Link
              href={`/org/${orgSlug}/lead-sources/${source.id}`}
              className="font-medium text-brand-600 hover:underline"
            >
              {source.name} — {source.source_type}
            </Link>
            <StatusBadge status={source.status} />
          </Card>
        ))}
        {leadSources.length === 0 ? (
          <p className="text-sm text-muted">No lead sources yet.</p>
        ) : null}
      </div>

      <Section title="Create a lead source">
        <CreateLeadSourceForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
