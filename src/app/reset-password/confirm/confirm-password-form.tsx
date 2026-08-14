"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Field } from "@/components/Field";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";

export function ConfirmPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage("Could not update your password. Request a new reset link.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label="New password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      {errorMessage ? <p className="text-sm text-danger-text">{errorMessage}</p> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
