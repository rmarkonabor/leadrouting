import { getVerifiedUser } from "@/lib/supabase/get-verified-user";
import { listMyMemberships } from "@/modules/organizations/get-current-organization";
import { CreateOrganizationForm } from "@/modules/organizations/create-organization-form";
import { signOutAction } from "@/modules/auth/actions";

export default async function HomePage() {
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <main>
        <h1>Lead Routing</h1>
        <p>
          <a href="/login">Sign in</a> to continue.
        </p>
      </main>
    );
  }

  const memberships = await listMyMemberships();

  return (
    <main>
      <h1>Lead Routing</h1>
      <p>Signed in as {user.email}.</p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>

      <section>
        <h2>Your organizations</h2>
        {memberships.length === 0 ? (
          <p>You do not belong to any organization yet.</p>
        ) : (
          <ul>
            {memberships.map((membership) => (
              <li key={membership.organizationId}>
                {membership.organizationName} ({membership.organizationSlug}) —{" "}
                {membership.role} — {membership.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Create an organization</h2>
        <CreateOrganizationForm />
      </section>
    </main>
  );
}
