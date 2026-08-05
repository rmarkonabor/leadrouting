"use client";

import { useActionState } from "react";
import { inviteUserFormAction, type InviteUserFormState } from "@/modules/users/actions";

export function InviteUserForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = inviteUserFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<InviteUserFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction}>
      <label>
        Email
        <input type="email" name="email" required />
      </label>
      <label>
        Role
        <select name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="team_manager">Team manager</option>
          <option value="org_admin">Organization admin</option>
        </select>
      </label>
      <button type="submit" disabled={pending}>
        Invite
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
