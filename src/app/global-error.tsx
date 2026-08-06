"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * React global error capture (spec §47): Next.js renders this in place of
 * the root layout when an error escapes every nested error boundary, so it
 * must render its own <html>/<body>. Reports through the same sanitized
 * Sentry pipeline as everything else — no raw error details are shown to
 * the user beyond a generic message.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        <p>The error has been reported. Please try again.</p>
      </body>
    </html>
  );
}
