import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireOrgAdminContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";

const DEFAULT_PAGE_SIZE = 50;

export interface ListAuditLogsFilters {
  page?: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ListAuditLogsResult {
  logs: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Lists audit log entries (spec §46), org_admin only per
 * docs/permissions-matrix.md — enforced here before any query runs, on top
 * of the org_admin-only `audit_logs_select_org_admin` RLS policy.
 */
export async function listAuditLogs(
  organizationSlug: string | undefined,
  filters: ListAuditLogsFilters = {},
): Promise<ListAuditLogsResult> {
  const { membership } = await requireOrgAdminContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", membership.organizationId);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw toAppError(error);

  return { logs: data ?? [], total: count ?? 0, page, pageSize };
}
