"use client";

import { useActionState } from "react";
import { inviteUserFormAction, type InviteUserFormState } from "@/modules/users/actions";
import { Field } from "@/components/Field";
import { Input, Select } from "@/components/Input";
import { Button } from "@/components/Button";

export function InviteUserForm({ orgSlug }: { orgSlug: string }) {
  const boundAction = inviteUserFormAction.bind(null, orgSlug);
  const [state, formAction, pending] = useActionState<InviteUserFormState, FormData>(
    boundAction,
    {},
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3">
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" name="email" required />
      </Field>
      <Field label="Role" htmlFor="role">
        <Select id="role" name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="team_manager">Team manager</option>
          <option value="org_admin">Organization admin</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        Invite
      </Button>
      {state.error ? <p className="text-sm text-danger-text">{state.error}</p> : null}
    </form>
  );
}
