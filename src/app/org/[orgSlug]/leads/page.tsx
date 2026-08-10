import Link from "next/link";
import { listLeads, type ListLeadsFilters } from "@/modules/leads/list-leads";
import { toAppError } from "@/lib/errors/app-error";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(searchParams: SearchParams): ListLeadsFilters {
  const priorityRaw = first(searchParams.priority);
  return {
    page: first(searchParams.page) ? Number(first(searchParams.page)) : undefined,
    search: first(searchParams.search) || undefined,
    dateFrom: first(searchParams.dateFrom) || undefined,
    dateTo: first(searchParams.dateTo) || undefined,
    leadStatus: first(searchParams.leadStatus) || undefined,
    assignmentStatus: first(searchParams.assignmentStatus) || undefined,
    teamId: first(searchParams.teamId) || undefined,
    userId: first(searchParams.userId) || undefined,
    leadSourceId: first(searchParams.leadSourceId) || undefined,
    city: first(searchParams.city) || undefined,
    stateProvince: first(searchParams.stateProvince) || undefined,
    postalCode: first(searchParams.postalCode) || undefined,
    manualReviewStatus: (first(searchParams.manualReviewStatus) as never) || undefined,
    duplicateStatus: (first(searchParams.duplicateStatus) as never) || undefined,
    priority: priorityRaw ? Number(priorityRaw) : undefined,
    customVariableKey: first(searchParams.customVariableKey) || undefined,
    customVariableValue: first(searchParams.customVariableValue) || undefined,
  };
}

function buildQuery(
  searchParams: SearchParams,
  overrides: Record<string, string>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const v = first(value);
    if (v) params.set(key, v);
  }
  for (const [key, value] of Object.entries(overrides)) {
    params.set(key, value);
  }
  return params.toString();
}

export default async function LeadListPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const filters = parseFilters(resolvedSearchParams);

  const [result, loadError] = await listLeads(orgSlug, filters).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !result) {
    return (
      <main>
        <h1>Leads</h1>
        <p role="alert">{loadError ?? "Something went wrong loading leads."}</p>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <main>
      <h1>Leads</h1>

      <form method="get">
        <label>
          Search
          <input type="text" name="search" defaultValue={filters.search ?? ""} />
        </label>
        <label>
          From
          <input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ""} />
        </label>
        <label>
          To
          <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} />
        </label>
        <label>
          Lead status
          <input type="text" name="leadStatus" defaultValue={filters.leadStatus ?? ""} />
        </label>
        <label>
          Assignment status
          <input
            type="text"
            name="assignmentStatus"
            defaultValue={filters.assignmentStatus ?? ""}
          />
        </label>
        <label>
          City
          <input type="text" name="city" defaultValue={filters.city ?? ""} />
        </label>
        <label>
          State / province
          <input
            type="text"
            name="stateProvince"
            defaultValue={filters.stateProvince ?? ""}
          />
        </label>
        <label>
          Postal code
          <input type="text" name="postalCode" defaultValue={filters.postalCode ?? ""} />
        </label>
        <label>
          Manual review status
          <select
            name="manualReviewStatus"
            defaultValue={filters.manualReviewStatus ?? ""}
          >
            <option value="">Any</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label>
          Duplicate status
          <select name="duplicateStatus" defaultValue={filters.duplicateStatus ?? ""}>
            <option value="">Any</option>
            <option value="none">None</option>
            <option value="duplicate">Duplicate</option>
            <option value="possible_duplicate">Possible duplicate</option>
          </select>
        </label>
        <label>
          Team ID
          <input type="text" name="teamId" defaultValue={filters.teamId ?? ""} />
        </label>
        <label>
          User ID
          <input type="text" name="userId" defaultValue={filters.userId ?? ""} />
        </label>
        <label>
          Lead source ID
          <input
            type="text"
            name="leadSourceId"
            defaultValue={filters.leadSourceId ?? ""}
          />
        </label>
        <label>
          Custom variable key
          <input
            type="text"
            name="customVariableKey"
            defaultValue={filters.customVariableKey ?? ""}
          />
        </label>
        <label>
          Custom variable value
          <input
            type="text"
            name="customVariableValue"
            defaultValue={filters.customVariableValue ?? ""}
          />
        </label>
        <button type="submit">Apply filters</button>
        <Link href={`/org/${orgSlug}/leads`}>Clear filters</Link>
      </form>

      {result.leads.length === 0 ? (
        <p>No leads match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
              <th>Lead status</th>
              <th>Assignment status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {result.leads.map((lead) => (
              <tr key={String(lead.id)}>
                <td>
                  <Link href={`/org/${orgSlug}/leads/${lead.id}`}>
                    {[lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
                      String(lead.full_name ?? "Unnamed lead")}
                  </Link>
                </td>
                <td>{String(lead.email ?? "")}</td>
                <td>{String(lead.phone ?? "")}</td>
                <td>{String(lead.city ?? "")}</td>
                <td>{String(lead.lead_status ?? "")}</td>
                <td>{String(lead.assignment_status ?? "")}</td>
                <td>{String(lead.created_at ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav aria-label="Pagination">
        <span>
          Page {result.page} of {totalPages} ({result.total} total)
        </span>
        {result.page > 1 ? (
          <Link
            href={`/org/${orgSlug}/leads?${buildQuery(resolvedSearchParams, {
              page: String(result.page - 1),
            })}`}
          >
            Previous
          </Link>
        ) : null}
        {result.page < totalPages ? (
          <Link
            href={`/org/${orgSlug}/leads?${buildQuery(resolvedSearchParams, {
              page: String(result.page + 1),
            })}`}
          >
            Next
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
