import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { toAppError, AppError } from "@/lib/errors/app-error";
import type { IntegrationLogStatus } from "@/lib/supabase/database.types";

const DEFAULT_PAGE_SIZE = 50;

export interface ListIntegrationLogsFilters {
  page?: number;
  pageSize?: number;
  provider?: string;
  status?: IntegrationLogStatus;
}

/** org_admin only (docs/permissions-matrix.md "View integration logs"). Spec §44 admin capabilities. */
export async function listIntegrationLogs(
  organizationSlug: string | undefined,
  filters: ListIntegrationLogsFilters = {},
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  let query = supabase
    .from("integration_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", membership.organizationId);

  if (filters.provider) query = query.eq("provider", filters.provider);
  if (filters.status) query = query.eq("status", filters.status);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw toAppError(error);

  return { logs: data ?? [], total: count ?? 0, page, pageSize };
}

export async function listWebhookDeliveries(
  organizationSlug: string | undefined,
  filters: { page?: number; pageSize?: number } = {},
) {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("webhook_deliveries")
    .select("*", { count: "exact" })
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw toAppError(error);
  return { deliveries: data ?? [], total: count ?? 0, page, pageSize };
}

/** Manual retry (spec §44 admin capability). Delegates to the DB function so authorization + queue re-send happen atomically. */
export async function retryIntegrationJob(
  organizationSlug: string | undefined,
  jobId: string,
) {
  await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("retry_integration_job", {
    p_job_id: jobId,
  });
  if (error) throw toAppError(error);
  if (!data) throw new AppError("not_found", "Integration job not found.");
  return data;
}

/** Mark an item resolved (spec §44 admin capability) — the admin fixed it manually outside this system. */
export async function markIntegrationLogResolved(
  organizationSlug: string | undefined,
  logId: string,
) {
  await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("mark_integration_log_resolved", {
    p_log_id: logId,
  });
  if (error) throw toAppError(error);
  return data;
}
