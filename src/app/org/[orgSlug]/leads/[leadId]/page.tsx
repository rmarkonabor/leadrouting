import { getLeadDetail } from "@/modules/leads/get-lead-detail";
import { listLeadStatusDefinitions } from "@/modules/leads/lead-statuses";
import { UpdateStatusForm } from "./update-status-form";
import { AddNoteForm } from "./add-note-form";
import { toAppError } from "@/lib/errors/app-error";
import type { RoutingExplanationLike } from "@/modules/routing/format-explanation";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Card, Section } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";
import { CodeBlock } from "@/components/CodeBlock";
import { RoutingResultView } from "@/components/RoutingResultView";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; leadId: string }>;
}) {
  const { orgSlug, leadId } = await params;

  const [data, loadError] = await Promise.all([
    getLeadDetail(orgSlug, leadId),
    listLeadStatusDefinitions(orgSlug),
  ]).then(
    ([detail, statuses]) => [{ detail, statuses }, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !data) {
    return (
      <PageContainer>
        <PageTitle>Lead</PageTitle>
        <p role="alert" className="text-sm text-danger-text">
          {loadError ?? "Something went wrong loading this lead."}
        </p>
      </PageContainer>
    );
  }

  const { detail, statuses } = data;
  const { lead } = detail;

  return (
    <PageContainer>
      <PageTitle>
        {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead"}
      </PageTitle>

      <Section title="Contact">
        <Card className="flex flex-col gap-1 text-sm">
          <p>Email: {String(lead.email ?? "—")}</p>
          <p>Phone: {String(lead.phone ?? "—")}</p>
          <p>
            Address:{" "}
            {[
              lead.street_address,
              lead.unit_number,
              lead.city,
              lead.state_province,
              lead.postal_code,
            ]
              .filter(Boolean)
              .join(", ") || "—"}
          </p>
          <p>Message: {String(lead.message ?? "—")}</p>
        </Card>
      </Section>

      <Section title="Custom variables">
        {detail.customValues.length === 0 ? (
          <p className="text-sm text-muted">No custom variables.</p>
        ) : (
          <Card>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.customValues.map((cv: Record<string, unknown>) => (
                <li key={String(cv.id)}>
                  <span className="font-medium">
                    {String(
                      (cv.custom_variable_definitions as Record<string, unknown> | null)
                        ?.name ?? cv.variable_definition_id,
                    )}
                  </span>
                  : {JSON.stringify(cv.value)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Status">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Current:</span>
          <StatusBadge status={lead.lead_status as string | null} />
        </div>
        <UpdateStatusForm
          orgSlug={orgSlug}
          leadId={leadId}
          currentStatus={(lead.lead_status as string | null) ?? null}
          statusOptions={statuses}
        />
        <p className="text-sm font-medium text-muted">Status history</p>
        {detail.statusHistory.length === 0 ? (
          <p className="text-sm text-muted">No status changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.statusHistory.map((entry: Record<string, unknown>) => (
              <li key={String(entry.id)} className="flex items-center gap-2">
                <span className="text-muted">{String(entry.created_at)}</span>
                <StatusBadge status={(entry.from_status as string | null) ?? null} />
                <span>→</span>
                <StatusBadge status={entry.to_status as string} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Assignment">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Status:</span>
          <StatusBadge status={lead.assignment_status as string | null} />
        </div>
        {detail.assignmentExplanation ? (
          <Card>
            <RoutingResultView
              result={detail.assignmentExplanation as unknown as RoutingExplanationLike}
            />
          </Card>
        ) : (
          <p className="text-sm text-muted">No routing explanation recorded yet.</p>
        )}
        <p className="text-sm font-medium text-muted">Assignment history</p>
        {detail.assignments.length === 0 ? (
          <p className="text-sm text-muted">No assignments yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.assignments.map((assignment: Record<string, unknown>) => (
              <li key={String(assignment.id)} className="flex items-center gap-2">
                <span className="text-muted">{String(assignment.created_at)}</span>
                <span>user {String(assignment.user_id)}</span>
                <StatusBadge status={assignment.status as string} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes">
        <AddNoteForm orgSlug={orgSlug} leadId={leadId} />
        {detail.notes.length === 0 ? (
          <p className="text-sm text-muted">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.notes.map((note: Record<string, unknown>) => (
              <li key={String(note.id)}>
                <span className="text-muted">{String(note.created_at)}:</span>{" "}
                {String(note.content)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activity timeline">
        {detail.activities.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.activities.map((activity: Record<string, unknown>) => (
              <li key={String(activity.id)} className="flex items-center gap-2">
                <span className="text-muted">{String(activity.created_at)}</span>
                <StatusBadge status={activity.activity_type as string} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Integration status">
        <p className="text-sm text-muted">{detail.integrationStatus.note}</p>
      </Section>

      {detail.canViewOriginalPayload ? (
        <Section title="Original submission">
          {detail.originalPayload ? (
            <details>
              <summary className="cursor-pointer text-sm text-muted">Raw payload</summary>
              <div className="mt-2">
                <CodeBlock value={detail.originalPayload} />
              </div>
            </details>
          ) : (
            <p className="text-sm text-muted">
              No submission log recorded for this lead.
            </p>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}
