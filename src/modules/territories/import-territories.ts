import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { AppError, toAppError } from "@/lib/errors/app-error";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { logger } from "@/lib/logging/logger";
import { parseCsvToObjects } from "@/modules/imports/csv";
import { isPostgisAvailable } from "./postgis-availability";
import {
  validateTerritoryImportRows,
  generateTerritoryErrorCsv,
  type ParsedTerritoryImportRow,
  type ValidatedTerritoryImportRow,
} from "./validate-territory-rows";

function toParsedRow(record: Record<string, string>): ParsedTerritoryImportRow {
  return {
    name: record["name"] ?? "",
    territoryType: record["territory_type"] ?? record["type"] ?? "",
    country: record["country"] ?? "",
    stateProvince: record["state_province"] ?? record["state"] ?? "",
    county: record["county"] ?? "",
    city: record["city"] ?? "",
    neighborhood: record["neighborhood"] ?? "",
    postalCode: record["postal_code"] ?? record["postal code"] ?? record["zip"] ?? "",
    centerLatitude: record["center_latitude"] ?? record["latitude"] ?? "",
    centerLongitude: record["center_longitude"] ?? record["longitude"] ?? "",
    radiusDistance: record["radius_distance"] ?? record["radius"] ?? "",
    priority: record["priority"] ?? "",
    status: record["status"] ?? "",
  };
}

function summarize(rows: ValidatedTerritoryImportRow[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}

/**
 * Parses and validates a territory-import CSV (postal codes and other
 * territory types), persisting the preview as one `import_jobs` row (reusing
 * Milestone 2's `import_type = 'territories'`) plus one `import_rows` row
 * per source row. Creates no territories yet. org_admin only.
 */
export async function createTerritoryImportPreview(
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
  const postgisAvailable = await isPostgisAvailable(supabase);

  const parsedRows = rows.map(toParsedRow);
  const validatedRows = validateTerritoryImportRows(parsedRows, { postgisAvailable });

  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      organization_id: membership.organizationId,
      import_type: "territories",
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
    action: "territory_import_job_created",
    entityType: "import_job",
    entityId: job.id,
    afterData: summarize(validatedRows),
  });

  return { job, validatedRows };
}

export interface ConfirmTerritoryImportResult {
  aborted: boolean;
  createdCount: number;
  failedCount: number;
  reason?: string;
}

/**
 * Confirms a previously previewed territory import. Mirrors Milestone 2's
 * `confirmImport`: if `allow_partial` is false and any row is invalid, this
 * creates *zero* territory rows and marks the job failed. Unlike user
 * import, territory creation is a single Postgres insert (no external Auth
 * API involved), so this achieves true all-or-nothing atomicity for the
 * non-partial case via a single batched insert — a stronger guarantee than
 * Milestone 2 could make, see docs/decisions.md.
 */
export async function confirmTerritoryImport(
  organizationSlug: string | undefined,
  importJobId: string,
): Promise<ConfirmTerritoryImportResult> {
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
      action: "territory_import_confirm_aborted",
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

  const territoriesToInsert = validRows
    .map((row) => {
      const stored = row.raw_data as {
        normalized?: ValidatedTerritoryImportRow["normalized"];
      };
      if (!stored.normalized) return null;
      const n = stored.normalized;
      return {
        rowId: row.id,
        record: {
          organization_id: membership.organizationId,
          name: n.name,
          territory_type: n.territoryType,
          country: n.country,
          state_province: n.stateProvince,
          county: n.county,
          city: n.city,
          neighborhood: n.neighborhood,
          postal_code: n.postalCode,
          priority: n.priority,
          status: n.status,
          ...(n.territoryType === "radius"
            ? {
                center_geography: `SRID=4326;POINT(${n.centerLongitude} ${n.centerLatitude})`,
                center_latitude: n.centerLatitude,
                center_longitude: n.centerLongitude,
                radius_distance: n.radiusDistance,
              }
            : {}),
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  let createdCount = 0;
  let failedCount = 0;

  if (territoriesToInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("territories")
      .insert(territoriesToInsert.map((t) => t.record))
      .select("id");

    if (insertError) {
      logger.error("territory_import_batch_insert_failed", {
        organization_id: membership.organizationId,
        job_id: importJobId,
        error_code: insertError.code,
      });
      await supabase
        .from("import_rows")
        .update({ status: "invalid", errors: ["Batch insert failed."] })
        .in(
          "id",
          territoriesToInsert.map((t) => t.rowId),
        );
      failedCount = territoriesToInsert.length;
    } else {
      createdCount = inserted?.length ?? 0;
      await supabase
        .from("import_rows")
        .update({ status: "imported" })
        .in(
          "id",
          territoriesToInsert.map((t) => t.rowId),
        );
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
    action: "territory_import_confirmed",
    entityType: "import_job",
    entityId: importJobId,
    afterData: { created: createdCount, failed: failedCount },
  });

  return { aborted: false, createdCount, failedCount };
}

export async function getTerritoryImportErrorCsv(
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

  const validated: ValidatedTerritoryImportRow[] = (importRows ?? []).map((r) => {
    const stored = r.raw_data as { raw: ParsedTerritoryImportRow };
    return {
      rowNumber: r.row_number,
      raw: stored.raw,
      status: r.status === "valid" || r.status === "imported" ? "valid" : "invalid",
      errors: r.errors as string[],
    };
  });

  return generateTerritoryErrorCsv(validated);
}
