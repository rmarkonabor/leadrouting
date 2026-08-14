import { runTerritoryConflictDetection } from "@/modules/territories/run-conflict-detection";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Card } from "@/components/Card";
import { Badge, type BadgeVariant } from "@/components/Badge";

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  error: "danger",
  warning: "warning",
  info: "info",
};

export default async function TerritoryConflictsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [warnings, loadError] = await runTerritoryConflictDetection(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !warnings) {
    return (
      <PageContainer>
        <PageTitle>Territory conflicts</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  if (warnings.length === 0) {
    return (
      <PageContainer>
        <PageTitle>Territory conflicts</PageTitle>
        <p className="text-sm text-muted">No conflicts or coverage issues detected.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Territory conflicts</PageTitle>
      <div className="flex flex-col gap-2">
        {warnings.map((warning, index) => (
          <Card key={`${warning.code}-${index}`} className="flex items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[warning.severity] ?? "neutral"}>
              {warning.severity}
            </Badge>
            <span className="text-sm">{warning.message}</span>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
