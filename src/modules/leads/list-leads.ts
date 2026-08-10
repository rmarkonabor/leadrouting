import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembershipContext } from "@/lib/permissions/require-context";
import { toAppError } from "@/lib/errors/app-error";
import type {
  LeadDuplicateStatus,
  ManualReviewStatus,
} from "@/lib/supabase/database.types";

const DEFAULT_PAGE_SIZE = 25;

/** Spec §36.2's 13 lead-list filters, all optional. */
export interface ListLeadsFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  leadStatus?: string;
  assignmentStatus?: string;
  teamId?: string;
  userId?: string;
  leadSourceId?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  manualReviewStatus?: ManualReviewStatus;
  duplicateStatus?: LeadDuplicateStatus;
  priority?: number;
  customVariableKey?: string;
  customVariableValue?: string;
}

export interface ListLeadsResult {
  leads: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Lists leads visible to the caller (spec §36.1/§36.2). RLS
 * (`leads_select_scoped`, Milestone 3) is the actual visibility gate —
 * this never needs to filter by role itself: an agent's query and an
 * org_admin's query hit the exact same `.from("leads")` call and simply
 * come back with different rows.
 *
 * Two filters (`manualReviewStatus`, the custom-variable pair) need a join
 * PostgREST's query builder can't express directly, so they resolve to a
 * candidate `lead_id` list first, then narrow the main query with `.in()`.
 */
export async function listLeads(
  organizationSlug: string | undefined,
  filters: ListLeadsFilters = {},
): Promise<ListLeadsResult> {
  const { membership } = await requireMembershipContext(organizationSlug);
  const supabase = await createServerSupabaseClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  let leadIdConstraint: string[] | null = null;

  if (filters.manualReviewStatus) {
    const { data: items, error } = await supabase
      .from("manual_review_items")
      .select("lead_id")
      .eq("organization_id", membership.organizationId)
      .eq("status", filters.manualReviewStatus);
    if (error) throw toAppError(error);
    leadIdConstraint = (items ?? []).map((i) => i.lead_id);
  }

  if (filters.customVariableKey && filters.customVariableValue !== undefined) {
    const { data: definition } = await supabase
      .from("custom_variable_definitions")
      .select("id")
      .eq("organization_id", membership.organizationId)
      .eq("internal_key", filters.customVariableKey)
      .single();

    let customLeadIds: string[] = [];
    if (definition) {
      // Best-effort equality match on a jsonb column — exact match only,
      // since custom variable values can be any JSON shape (text, number,
      // boolean, array) and a generic string filter can't express partial
      // matches across all of them.
      const { data: values, error } = await supabase
        .from("lead_custom_values")
        .select("lead_id")
        .eq("organization_id", membership.organizationId)
        .eq("variable_definition_id", definition.id)
        .eq("value", JSON.stringify(filters.customVariableValue) as never);
      if (error) throw toAppError(error);
      customLeadIds = (values ?? []).map((v) => v.lead_id);
    }
    leadIdConstraint = leadIdConstraint
      ? leadIdConstraint.filter((id) => customLeadIds.includes(id))
      : customLeadIds;
  }

  if (leadIdConstraint !== null && leadIdConstraint.length === 0) {
    return { leads: [], total: 0, page, pageSize };
  }

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("organization_id", membership.organizationId);

  if (leadIdConstraint !== null) {
    query = query.in("id", leadIdConstraint);
  }
  if (filters.search) {
    const term = filters.search.trim();
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
    );
  }
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters.leadStatus) query = query.eq("lead_status", filters.leadStatus);
  if (filters.assignmentStatus)
    query = query.eq("assignment_status", filters.assignmentStatus);
  if (filters.teamId) query = query.eq("assigned_team_id", filters.teamId);
  if (filters.userId) query = query.eq("assigned_user_id", filters.userId);
  if (filters.leadSourceId) query = query.eq("lead_source_id", filters.leadSourceId);
  if (filters.city) query = query.ilike("city", `%${filters.city}%`);
  if (filters.stateProvince) query = query.eq("state_province", filters.stateProvince);
  if (filters.postalCode) query = query.eq("postal_code", filters.postalCode);
  if (filters.duplicateStatus)
    query = query.eq("duplicate_status", filters.duplicateStatus);
  if (filters.priority !== undefined) query = query.eq("priority", filters.priority);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw toAppError(error);

  return { leads: data ?? [], total: count ?? 0, page, pageSize };
}
