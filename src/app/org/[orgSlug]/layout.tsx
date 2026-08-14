import Link from "next/link";
import type { ReactNode } from "react";

const NAV_GROUPS: { heading: string; items: { label: string; path: string }[] }[] = [
  { heading: "Overview", items: [{ label: "Dashboard", path: "dashboard" }] },
  {
    heading: "Leads",
    items: [
      { label: "Leads", path: "leads" },
      { label: "New lead", path: "leads/new" },
      { label: "Manual review", path: "manual-review" },
      { label: "Notifications", path: "notifications" },
    ],
  },
  {
    heading: "Routing",
    items: [
      { label: "Routing flows", path: "routing" },
      { label: "Simulator", path: "routing/simulator" },
      { label: "Routing health", path: "routing-health" },
    ],
  },
  {
    heading: "Recipients",
    items: [
      { label: "Teams", path: "teams" },
      { label: "Users", path: "users" },
      { label: "Availability", path: "availability" },
      { label: "Territories", path: "territories" },
    ],
  },
  {
    heading: "Intake",
    items: [
      { label: "Lead sources", path: "lead-sources" },
      { label: "Custom variables", path: "custom-variables" },
      { label: "Submission logs", path: "submission-logs" },
    ],
  },
  {
    heading: "Integrations",
    items: [
      { label: "CRM integration", path: "crm-integration" },
      { label: "Webhooks", path: "webhooks" },
      { label: "Integration logs", path: "integration-logs" },
    ],
  },
  { heading: "Admin", items: [{ label: "Audit logs", path: "audit-logs" }] },
];

/**
 * Shared navigation for every /org/[orgSlug]/* page. There was previously
 * no way to reach any org page except by typing its URL directly — the
 * root page listed an org's name/slug as plain text, not a link, and no
 * page linked to any sibling page. This does not itself enforce anything:
 * every link's target page independently enforces its own auth
 * (requireMembershipContext/requireOrgAdminContext) and will show its own
 * "not permitted" error if a role can't actually use it — this is
 * navigation only, not an authorization surface.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex-shrink-0 border-b border-border bg-surface md:h-screen md:w-56 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex flex-col gap-4 p-4">
          <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
            ← All organizations
          </Link>
          <nav aria-label="Organization sections" className="flex flex-col gap-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.heading} className="flex flex-col gap-1">
                <p className="px-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  {group.heading}
                </p>
                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <Link
                        href={`/org/${orgSlug}/${item.path}`}
                        className="block rounded-md px-2 py-1.5 text-sm hover:bg-neutral-bg"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
