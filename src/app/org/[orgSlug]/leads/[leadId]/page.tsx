import { getLeadDetail } from "@/modules/leads/get-lead-detail";
import { listLeadStatusDefinitions } from "@/modules/leads/lead-statuses";
import { UpdateStatusForm } from "./update-status-form";
import { AddNoteForm } from "./add-note-form";
import { toAppError } from "@/lib/errors/app-error";

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
      <main>
        <h1>Lead</h1>
        <p role="alert">{loadError ?? "Something went wrong loading this lead."}</p>
      </main>
    );
  }

  const { detail, statuses } = data;
  const { lead } = detail;

  return (
    <main>
      <h1>
        {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unnamed lead"}
      </h1>

      <section>
        <h2>Contact</h2>
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
      </section>

      <section>
        <h2>Custom variables</h2>
        {detail.customValues.length === 0 ? (
          <p>No custom variables.</p>
        ) : (
          <ul>
            {detail.customValues.map((cv: Record<string, unknown>) => (
              <li key={String(cv.id)}>
                {String(
                  (cv.custom_variable_definitions as Record<string, unknown> | null)
                    ?.name ?? cv.variable_definition_id,
                )}
                : {JSON.stringify(cv.value)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Status</h2>
        <p>Current: {String(lead.lead_status ?? "—")}</p>
        <UpdateStatusForm
          orgSlug={orgSlug}
          leadId={leadId}
          currentStatus={(lead.lead_status as string | null) ?? null}
          statusOptions={statuses}
        />
        <h3>Status history</h3>
        {detail.statusHistory.length === 0 ? (
          <p>No status changes yet.</p>
        ) : (
          <ul>
            {detail.statusHistory.map((entry: Record<string, unknown>) => (
              <li key={String(entry.id)}>
                {String(entry.created_at)}: {String(entry.from_status ?? "—")} →{" "}
                {String(entry.to_status)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Assignment</h2>
        <p>Status: {String(lead.assignment_status ?? "—")}</p>
        <p>Explanation: {String(detail.assignmentExplanation ?? "—")}</p>
        <h3>Assignment history</h3>
        {detail.assignments.length === 0 ? (
          <p>No assignments yet.</p>
        ) : (
          <ul>
            {detail.assignments.map((assignment: Record<string, unknown>) => (
              <li key={String(assignment.id)}>
                {String(assignment.created_at)} — user {String(assignment.user_id)} —{" "}
                {String(assignment.status)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Notes</h2>
        <AddNoteForm orgSlug={orgSlug} leadId={leadId} />
        {detail.notes.length === 0 ? (
          <p>No notes yet.</p>
        ) : (
          <ul>
            {detail.notes.map((note: Record<string, unknown>) => (
              <li key={String(note.id)}>
                {String(note.created_at)}: {String(note.content)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Activity timeline</h2>
        {detail.activities.length === 0 ? (
          <p>No activity yet.</p>
        ) : (
          <ul>
            {detail.activities.map((activity: Record<string, unknown>) => (
              <li key={String(activity.id)}>
                {String(activity.created_at)}: {String(activity.activity_type)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Integration status</h2>
        <p>{detail.integrationStatus.note}</p>
      </section>

      {detail.canViewOriginalPayload ? (
        <section>
          <h2>Original submission</h2>
          {detail.originalPayload ? (
            <details>
              <summary>Raw payload</summary>
              <pre>{JSON.stringify(detail.originalPayload, null, 2)}</pre>
            </details>
          ) : (
            <p>No submission log recorded for this lead.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
