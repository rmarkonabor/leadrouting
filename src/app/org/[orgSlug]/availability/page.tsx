import { getOwnAvailability } from "@/modules/availability/availability";
import { UpdateAvailabilityForm } from "./update-availability-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { StatusBadge } from "@/components/Badge";

export default async function AvailabilityPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [result, loadError] = await getOwnAvailability(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !result) {
    return (
      <PageContainer>
        <PageTitle>Availability</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  const currentStatus = result.availability?.availability_status ?? "available";

  return (
    <PageContainer>
      <PageTitle>Availability</PageTitle>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Current status:</span>
        <StatusBadge status={result.availability?.availability_status ?? null} />
      </div>
      <UpdateAvailabilityForm orgSlug={orgSlug} currentStatus={currentStatus} />
    </PageContainer>
  );
}
