import { listCustomVariableDefinitions } from "@/modules/custom-variables/custom-variables";
import { CreateCustomVariableForm } from "./create-custom-variable-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { Badge } from "@/components/Badge";

export default async function CustomVariablesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [definitions, loadError] = await listCustomVariableDefinitions(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !definitions) {
    return (
      <PageContainer>
        <PageTitle>Custom lead variables</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Custom lead variables</PageTitle>
      <div className="flex flex-col gap-2">
        {definitions.map((definition) => (
          <Card key={definition.id} className="flex items-center justify-between">
            <span className="text-sm">
              {definition.name} ({definition.internal_key})
            </span>
            <Badge variant="info">{definition.field_type}</Badge>
          </Card>
        ))}
        {definitions.length === 0 ? (
          <p className="text-sm text-muted">No custom variables yet.</p>
        ) : null}
      </div>

      <Section title="Create a custom variable">
        <CreateCustomVariableForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
