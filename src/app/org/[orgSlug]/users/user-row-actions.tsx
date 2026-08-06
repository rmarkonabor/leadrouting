"use client";

import { deactivateUserAction, activateUserAction } from "@/modules/users/actions";
import type { OrganizationUserStatus } from "@/lib/supabase/database.types";

export function UserRowActions({
  orgSlug,
  organizationUserId,
  status,
}: {
  orgSlug: string;
  organizationUserId: string;
  status: OrganizationUserStatus;
}) {
  if (status === "active") {
    return (
      <form action={deactivateUserAction.bind(null, orgSlug, organizationUserId)}>
        <button type="submit">Deactivate</button>
      </form>
    );
  }

  if (status === "inactive" || status === "suspended") {
    return (
      <form action={activateUserAction.bind(null, orgSlug, organizationUserId)}>
        <button type="submit">Reactivate</button>
      </form>
    );
  }

  return null;
}
