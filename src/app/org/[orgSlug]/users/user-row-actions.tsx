"use client";

import { deactivateUserAction, activateUserAction } from "@/modules/users/actions";
import type { OrganizationUserStatus } from "@/lib/supabase/database.types";
import { Button } from "@/components/Button";

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
        <Button type="submit" variant="danger">
          Deactivate
        </Button>
      </form>
    );
  }

  if (status === "inactive" || status === "suspended") {
    return (
      <form action={activateUserAction.bind(null, orgSlug, organizationUserId)}>
        <Button type="submit" variant="secondary">
          Reactivate
        </Button>
      </form>
    );
  }

  return null;
}
