import { NewLeadForm } from "../new-lead-form";

export default async function NewLeadPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <main>
      <h1>New lead</h1>
      <p>
        Creates a lead directly (spec §17&apos;s &quot;manual&quot; source type) and
        immediately runs live routing against it, the same as a real intake submission
        would.
      </p>
      <NewLeadForm orgSlug={orgSlug} />
    </main>
  );
}
