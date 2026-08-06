import { listTeams } from "@/modules/teams/teams";
import { CreateTeamForm } from "./create-team-form";
import { toAppError } from "@/lib/errors/app-error";

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [teams, loadError] = await listTeams(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !teams) {
    return (
      <main>
        <h1>Teams</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Teams</h1>
      <ul>
        {teams.map((team) => (
          <li key={team.id}>
            {team.name} — {team.status}
          </li>
        ))}
      </ul>

      <section>
        <h2>Create a team</h2>
        <CreateTeamForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
