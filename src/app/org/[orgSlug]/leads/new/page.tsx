import { NewLeadForm } from "../new-lead-form";
import { PageContainer, PageTitle } from "@/components/PageContainer";

export default async function NewLeadPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <PageContainer>
      <PageTitle>New lead</PageTitle>
      <p className="text-sm text-muted">
        Creates a lead directly (spec §17&apos;s &quot;manual&quot; source type) and
        immediately runs live routing against it, the same as a real intake submission
        would.
      </p>
      <NewLeadForm orgSlug={orgSlug} />
    </PageContainer>
  );
}
