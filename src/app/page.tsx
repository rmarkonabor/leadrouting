import Link from "next/link";
import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import { listMyMemberships } from "@/modules/organizations/get-current-organization";
import { CreateOrganizationForm } from "@/modules/organizations/create-organization-form";
import { signOutAction } from "@/modules/auth/actions";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Card, Section } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

export default async function HomePage() {
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <PageContainer>
        <PageTitle>Lead Routing</PageTitle>
        <p>
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>{" "}
          to continue.
        </p>
      </PageContainer>
    );
  }

  const memberships = await listMyMemberships();

  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <PageTitle>Lead Routing</PageTitle>
        <form action={signOutAction} className="flex items-center gap-3">
          <span className="text-sm text-muted">{user.email}</span>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </div>

      <Section title="Your organizations">
        {memberships.length === 0 ? (
          <p className="text-sm text-muted">You do not belong to any organization yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {memberships.map((membership) => (
              <Card
                key={membership.organizationId}
                className="flex items-center justify-between"
              >
                <Link
                  href={`/org/${membership.organizationSlug}/dashboard`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {membership.organizationName} ({membership.organizationSlug})
                </Link>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span>{membership.role}</span>
                  <Badge variant={membership.status === "active" ? "success" : "neutral"}>
                    {membership.status}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Create an organization">
        <CreateOrganizationForm />
      </Section>
    </PageContainer>
  );
}
