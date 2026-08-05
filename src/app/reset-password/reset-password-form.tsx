"use client";

import { useState, type FormEvent } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env/public";

export function ResetPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password/confirm`,
    });

    setIsSubmitting(false);
    // Always show the same confirmation, whether or not the email exists,
    // so this endpoint can't be used to enumerate accounts.
    setSubmitted(true);
  }

  if (submitted) {
    return <p>If an account exists for that email, a reset link has been sent.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
