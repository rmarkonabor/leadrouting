import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS: { label: string; path: string }[] = [
  { label: "Dashboard", path: "dashboard" },
  { label: "Leads", path: "leads" },
  { label: "New lead", path: "leads/new" },
  { label: "Manual review", path: "manual-review" },
  { label: "Notifications", path: "notifications" },
  { label: "Routing flows", path: "routing" },
  { label: "Routing simulator", path: "routing/simulator" },
  { label: "Routing health", path: "routing-health" },
  { label: "Territories", path: "territories" },
  { label: "Teams", path: "teams" },
  { label: "Users", path: "users" },
  { label: "Availability", path: "availability" },
  { label: "Lead sources", path: "lead-sources" },
  { label: "Submission logs", path: "submission-logs" },
  { label: "Custom variables", path: "custom-variables" },
  { label: "CRM integration", path: "crm-integration" },
  { label: "Webhooks", path: "webhooks" },
  { label: "Integration logs", path: "integration-logs" },
  { label: "Audit logs", path: "audit-logs" },
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
    <div>
      <header>
        <p>
          <Link href="/">All organizations</Link>
        </p>
        <nav aria-label="Organization sections">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <Link href={`/org/${orgSlug}/${item.path}`}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
    </div>
  );
}
