import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { logger } from "@/lib/logging/logger";
import { parseCsvToObjects } from "./csv";
import {
  validateUserImportRows,
  generateErrorCsv,
  type ParsedUserImportRow,
  type ValidatedUserImportRow,
} from "./validate-user-rows";

function toParsedRow(record: Record<string, string>): ParsedUserImportRow {
  return {
    name: record["name"] ?? record["user name"] ?? "",
    email: record["email"] ?? "",
    role: record["role"] ?? "",
    team: record["team"] ?? "",
    availability: record["availability"] ?? "",
    timezone: record["timezone"] ?? record["time zone"] ?? "",
    dailyLeadLimit: record["daily_lead_limit"] ?? record["daily lead capacity"] ?? "",
    activeLeadLimit: record["active_lead_limit"] ?? record["active lead capacity"] ?? "",
    assignmentWeight: record["assignment_weight"] ?? record["assignment weight"] ?? "",
  };
}

/**
 * Parses and validates a users CSV, persisting the preview as one
 * `import_jobs` row plus one `import_rows` row per source row (spec §14
 * steps 1-5: upload, column mapping — fixed headers in Phase 1 — validation
 * preview, duplicate detection, error display). Creates no users yet.
 * org_admin only.
 */
export async function createImportPreview(
  organizationSlug: string | undefined,
  csvText: string,
  allowPartial: boolean,
) {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const { rows } = parseCsvToObjects(csvText);
  if (rows.length === 0) {
    throw new AppError("invalid_input", "The CSV file has no data rows.");
  }

  const supabase = await createServerSupabaseClient();

  const [
    { data: teams, error: teamsError },
    { data: existingMembers, error: membersError },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name")
      .eq("organization_id", membership.organizationId),
    supabase
      .from("organization_users")
      .select("user_id")
      .eq("organization_id", membership.organizationId),
  ]);

  if (teamsError) throw toAppError(teamsError);
  if (membersError) throw toAppError(membersError);

  const teamIdsByLowercaseName = new Map(
    (teams ?? []).map((t) => [t.name.toLowerCase(), t.id]),
  );
  const existingMemberEmails = await lookupExistingMemberEmails(existingMembers ?? []);

  const parsedRows = rows.map(toParsedRow);
  const validatedRows = validateUserImportRows(parsedRows, {
    teamIdsByLowercaseName,
    existingMemberEmails,
  });

  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      organization_id: membership.organizationId,
      import_type: "users",
      status: "ready",
      allow_partial: allowPartial,
      created_by_user_id: user.id,
      summary: summarize(validatedRows),
    })
    .select()
    .single();

  if (jobError) throw toAppError(jobError);

  const { error: rowsError } = await supabase.from("import_rows").insert(
    validatedRows.map((r) => ({
      organization_id: membership.organizationId,
      import_job_id: job.id,
      row_number: r.rowNumber,
      raw_data: { raw: r.raw, normalized: r.normalized ?? null },
      status: r.status,
      errors: r.errors,
    })),
  );

  if (rowsError) throw toAppError(rowsError);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "import_job_created",
    entityType: "import_job",
    entityId: job.id,
    afterData: summarize(validatedRows),
  });

  return { job, validatedRows };
}

async function lookupExistingMemberEmails(
  members: { user_id: string }[],
): Promise<Set<string>> {
  if (members.length === 0) {
    return new Set();
  }

  const serviceRole = createServiceRoleClient();
  const emails = await Promise.all(
    members.map(async (m) => {
      const { data } = await serviceRole.auth.admin.getUserById(m.user_id);
      return data.user?.email?.toLowerCase() ?? null;
    }),
  );

  return new Set(emails.filter((e): e is string => e !== null));
}

function summarize(rows: ValidatedUserImportRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

export interface ConfirmImportResult {
  aborted: boolean;
  createdCount: number;
  failedCount: number;
  reason?: string;
}

/**
 * Confirms a previously previewed import job. Per spec §14: "Invalid
 * imports must not partially create records unless the administrator
 * explicitly chooses partial processing." If `allow_partial` is false and
 * any row is invalid, this creates *zero* organization_users rows and marks
 * the job failed — it never even attempts row-by-row creation. org_admin
 * only.
 *
 * Note: because creating a user requires the external Supabase Auth Admin
 * API (not just a database write), true single-transaction atomicity across
 * "auth user created" + "organization_users row created" is not achievable
 * the way a pure-SQL function can guarantee it — see docs/decisions.md
 * ADR-025 for this documented limitation. The guarantee this function does
 * provide, and the one spec §14 and this milestone's tests are about, is the
 * all-or-nothing *decision* to proceed at all: an invalid row blocks the
 * entire batch from being submitted for creation when partial processing
 * isn't explicitly allowed.
 */
export async function confirmImport(
  organizationSlug: string | undefined,
  importJobId: string,
): Promise<ConfirmImportResult> {
  const { user, membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .select()
    .eq("id", importJobId)
    .eq("organization_id", membership.organizationId)
    .single();

  if (jobError || !job) {
    throw new AppError("not_found", "Import job not found.");
  }

  if (job.status === "completed" || job.status === "importing") {
    throw new AppError("conflict", "This import has already been processed.");
  }

  const { data: importRows, error: rowsError } = await supabase
    .from("import_rows")
    .select()
    .eq("import_job_id", importJobId)
    .order("row_number");

  if (rowsError) throw toAppError(rowsError);

  const invalidRows = (importRows ?? []).filter((r) => r.status === "invalid");
  const validRows = (importRows ?? []).filter((r) => r.status === "valid");

  if (invalidRows.length > 0 && !job.allow_partial) {
    await supabase
      .from("import_jobs")
      .update({ status: "failed", summary: { ...job.summary, aborted: true } })
      .eq("id", importJobId);

    await logAuditEvent(supabase, {
      organizationId: membership.organizationId,
      actorUserId: user.id,
      action: "import_confirm_aborted",
      entityType: "import_job",
      entityId: importJobId,
      afterData: { invalid_count: invalidRows.length },
    });

    return {
      aborted: true,
      createdCount: 0,
      failedCount: 0,
      reason: "Import contains invalid rows and partial processing was not allowed.",
    };
  }

  await supabase
    .from("import_jobs")
    .update({ status: "importing" })
    .eq("id", importJobId);

  let createdCount = 0;
  let failedCount = 0;

  for (const row of validRows) {
    try {
      const stored = row.raw_data as {
        normalized?: {
          email: string;
          role: "org_admin" | "team_manager" | "agent";
          teamId: string | null;
        };
      };
      if (!stored.normalized) {
        throw new AppError("invalid_input", "Row is missing normalized import data.");
      }
      const { email, role, teamId } = stored.normalized;

      const { inviteUser } = await import("@/modules/users/invite-user");
      const membershipRow = await inviteUser(organizationSlug, { email, role });

      if (teamId) {
        await supabase.from("team_users").insert({
          organization_id: membership.organizationId,
          team_id: teamId,
          user_id: membershipRow.user_id,
          is_manager: false,
        });
      }

      await supabase.from("import_rows").update({ status: "imported" }).eq("id", row.id);
      createdCount += 1;
    } catch (error) {
      logger.error("import_row_create_failed", {
        organization_id: membership.organizationId,
        job_id: importJobId,
      });
      await supabase
        .from("import_rows")
        .update({
          status: "invalid",
          errors: [...(row.errors as unknown[]), toAppError(error).message],
        })
        .eq("id", row.id);
      failedCount += 1;
    }
  }

  await supabase
    .from("import_jobs")
    .update({
      status: "completed",
      summary: { ...job.summary, created: createdCount, failed: failedCount },
    })
    .eq("id", importJobId);

  await logAuditEvent(supabase, {
    organizationId: membership.organizationId,
    actorUserId: user.id,
    action: "import_confirmed",
    entityType: "import_job",
    entityId: importJobId,
    afterData: { created: createdCount, failed: failedCount },
  });

  return { aborted: false, createdCount, failedCount };
}

export async function getImportErrorCsv(
  organizationSlug: string | undefined,
  importJobId: string,
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);

  const supabase = await createServerSupabaseClient();
  const { data: importRows, error } = await supabase
    .from("import_rows")
    .select()
    .eq("import_job_id", importJobId)
    .eq("organization_id", membership.organizationId)
    .order("row_number");

  if (error) throw toAppError(error);

  const validated: ValidatedUserImportRow[] = (importRows ?? []).map((r) => {
    const stored = r.raw_data as { raw: ParsedUserImportRow };
    return {
      rowNumber: r.row_number,
      raw: stored.raw,
      status: r.status === "valid" || r.status === "imported" ? "valid" : "invalid",
      errors: r.errors as string[],
    };
  });

  return generateErrorCsv(validated);
}
