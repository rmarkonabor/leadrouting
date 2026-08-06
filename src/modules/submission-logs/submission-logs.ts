import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { mapPayload, type FieldMappingConfig } from "@/modules/field-mapping/map-payload";
import { validateLeadFields } from "@/modules/lead-intake/validate-lead-fields";

/**
 * Lists submission logs for the organization, most recent first. org_admin
 * only (docs/permissions-matrix.md "View submission logs"). Callers must
 * never pass `raw_payload`/`mapped_payload` from these rows into
 * lib/logging or Sentry (CLAUDE.md rule 18) — displaying them in this
 * org_admin-only UI page is the one place spec §20 requires viewing them.
 */
export async function listSubmissionLogs(organizationSlug: string | undefined) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("submission_logs")
    .select()
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw toAppError(error);
  }

  return data;
}

/**
 * Reads one submission log's full detail, including the original raw
 * payload (spec §20 "View the original payload") — org_admin only.
 */
export async function getSubmissionLog(
  organizationSlug: string | undefined,
  submissionLogId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("submission_logs")
    .select()
    .eq("id", submissionLogId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (error || !data) {
    throw new AppError("not_found", "Submission log not found.");
  }

  return data;
}

/**
 * Marks a submission as ignored (spec §20 "Mark the submission as
 * ignored"). org_admin only. Never creates or touches a lead.
 */
export async function ignoreSubmissionLog(
  organizationSlug: string | undefined,
  submissionLogId: string,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("submission_logs")
    .update({ status: "ignored" })
    .eq("id", submissionLogId)
    .eq("organization_id", membership.organizationId)
    .select()
    .single();

  if (error) {
    throw toAppError(error);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "submission_log_ignored",
    entityType: "submission_log",
    entityId: data.id,
  });

  return data;
}

/**
 * Re-runs mapping/validation against a submission log's stored payload
 * (spec §20 "Correct mapped values. Resubmit the lead.") — an org_admin can
 * pass `correctedPayload` to override the original raw payload before
 * re-mapping. Unlike the public intake path, this is session-authenticated,
 * so it writes the resulting lead directly (RLS-scoped, org_admin is
 * permitted to insert leads) rather than through the anon-callable
 * `record_lead_submission` function. Only re-runs if the log did not
 * already produce a lead.
 */
export async function resubmitSubmissionLog(
  organizationSlug: string | undefined,
  submissionLogId: string,
  correctedPayload?: Record<string, unknown>,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data: log, error: logError } = await supabase
    .from("submission_logs")
    .select()
    .eq("id", submissionLogId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (logError || !log) {
    throw new AppError("not_found", "Submission log not found.");
  }

  if (log.resulting_lead_id) {
    throw new AppError("conflict", "This submission already produced a lead.");
  }

  const payload = correctedPayload ?? (log.raw_payload as Record<string, unknown>);

  const { data: mappingRows, error: mappingError } = await supabase
    .from("field_mappings")
    .select()
    .eq("organization_id", membership.organizationId)
    .eq("lead_source_id", log.lead_source_id);

  if (mappingError) {
    throw toAppError(mappingError);
  }

  const mappings: FieldMappingConfig[] = (mappingRows ?? []).map((m) => ({
    sourceFieldName: m.source_field_name,
    destinationType: m.destination_type,
    destinationField: m.destination_field,
    dataType: m.data_type,
    required: m.required,
    defaultValue: m.default_value,
    transformation: m.transformation,
    validationRule: (m.validation_rule ?? {}) as FieldMappingConfig["validationRule"],
  }));

  const { mappedFields } = mapPayload(payload, mappings);
  const validationErrors = validateLeadFields(mappedFields, mappings);

  if (validationErrors.length > 0) {
    await supabase
      .from("submission_logs")
      .update({
        mapped_payload: mappedFields,
        validation_errors: validationErrors,
        status: "failed",
      })
      .eq("id", submissionLogId);
    throw new AppError("invalid_input", "The corrected payload is still invalid.", {
      details: validationErrors.map((message) => ({ message })),
    });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      organization_id: membership.organizationId,
      lead_source_id: log.lead_source_id,
      external_submission_id: log.external_submission_id,
      ...mappedFields,
    })
    .select()
    .single();

  if (leadError) {
    throw toAppError(leadError);
  }

  const { data: updatedLog, error: updateError } = await supabase
    .from("submission_logs")
    .update({
      mapped_payload: mappedFields,
      validation_errors: [],
      status: "resubmitted",
      resulting_lead_id: lead.id,
    })
    .eq("id", submissionLogId)
    .select()
    .single();

  if (updateError) {
    throw toAppError(updateError);
  }

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "submission_log_resubmitted",
    entityType: "submission_log",
    entityId: submissionLogId,
    afterData: { resulting_lead_id: lead.id },
  });

  return updatedLog;
}
