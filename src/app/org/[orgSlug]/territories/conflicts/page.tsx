import { runTerritoryConflictDetection } from "@/modules/territories/run-conflict-detection";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Territory conflicts</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (warnings.length === 0) {
    return (
      <main>
        <h1>Territory conflicts</h1>
        <p>No conflicts or coverage issues detected.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Territory conflicts</h1>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`}>
            <strong>[{warning.severity}]</strong> {warning.message}
          </li>
        ))}
      </ul>
    </main>
  );
}
