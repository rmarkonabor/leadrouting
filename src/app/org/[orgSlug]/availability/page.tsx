import { getOwnAvailability } from "@/modules/availability/availability";
import { UpdateAvailabilityForm } from "./update-availability-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Availability</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  const currentStatus = result.availability?.availability_status ?? "available";

  return (
    <main>
      <h1>Availability</h1>
      <p>Current status: {result.availability?.availability_status ?? "not set"}</p>
      <UpdateAvailabilityForm orgSlug={orgSlug} currentStatus={currentStatus} />
    </main>
  );
}
