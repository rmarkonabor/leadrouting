import { listOrganizationUsers } from "@/modules/users/manage-user";
import { InviteUserForm } from "./invite-user-form";
import { toAppError } from "@/lib/errors/app-error";
import { UserRowActions } from "./user-row-actions";

export default async function UsersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [users, loadError] = await listOrganizationUsers(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !users) {
    return (
      <main>
        <h1>Users</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.user_id}</td>
              <td>{u.role}</td>
              <td>{u.status}</td>
              <td>
                <UserRowActions
                  orgSlug={orgSlug}
                  organizationUserId={u.id}
                  status={u.status}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
        <h2>Invite a user</h2>
        <InviteUserForm orgSlug={orgSlug} />
      </section>
    </main>
  );
}
