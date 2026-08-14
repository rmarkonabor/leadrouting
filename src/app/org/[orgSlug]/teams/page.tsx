import { listTeams } from "@/modules/teams/teams";
import { CreateTeamForm } from "./create-team-form";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section, Card } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";

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
      <PageContainer>
        <PageTitle>Teams</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Teams</PageTitle>
      <div className="flex flex-col gap-2">
        {teams.map((team) => (
          <Card key={team.id} className="flex items-center justify-between">
            <span>{team.name}</span>
            <StatusBadge status={team.status} />
          </Card>
        ))}
        {teams.length === 0 ? <p className="text-sm text-muted">No teams yet.</p> : null}
      </div>

      <Section title="Create a team">
        <CreateTeamForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
