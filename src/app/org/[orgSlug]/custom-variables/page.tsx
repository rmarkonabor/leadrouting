import { listCustomVariableDefinitions } from "@/modules/custom-variables/custom-variables";
import { CreateCustomVariableForm } from "./create-custom-variable-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Custom lead variables</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Custom lead variables</h1>
      <ul>
        {definitions.map((definition) => (
          <li key={definition.id}>
            {definition.name} ({definition.internal_key}) — {definition.field_type}
          </li>
        ))}
      </ul>

      <section>
        <h2>Create a custom variable</h2>
        <CreateCustomVariableForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
