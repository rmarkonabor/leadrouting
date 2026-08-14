import { listOrganizationUsers } from "@/modules/users/manage-user";
import { InviteUserForm } from "./invite-user-form";
import { toAppError } from "@/lib/errors/app-error";
import { UserRowActions } from "./user-row-actions";
import { PageContainer, PageTitle } from "@/components/PageContainer";
import { Section } from "@/components/Card";
import { StatusBadge } from "@/components/Badge";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/Table";

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
      <PageContainer>
        <PageTitle>Users</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Users</PageTitle>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>User ID</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.user_id}</TableCell>
              <TableCell>{u.role}</TableCell>
              <TableCell>
                <StatusBadge status={u.status} />
              </TableCell>
              <TableCell>
                <UserRowActions
                  orgSlug={orgSlug}
                  organizationUserId={u.id}
                  status={u.status}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Section title="Invite a user">
        <InviteUserForm orgSlug={orgSlug} />
      </Section>
    </PageContainer>
  );
}
