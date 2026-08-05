"use client";

import { useState } from "react";

export function SentryTestButtons() {
  const [serverErrorStatus, setServerErrorStatus] = useState<string | null>(null);

  function throwBrowserError() {
    // Thrown inside an event handler, not during render, so React error
    // boundaries don't intercept it — Sentry's default global handlers
    // integration (window.onerror) captures it instead, exactly like a
    // real unhandled client-side error would be captured.
    throw new Error("Sentry browser test error (sentry-example-page button)");
  }

  async function throwServerError() {
    setServerErrorStatus("Requesting...");
    const response = await fetch("/api/sentry-example-api");
    setServerErrorStatus(`Request finished with status ${response.status}.`);
  }

  return (
    <div>
      <button type="button" onClick={throwBrowserError}>
        Throw browser test error
      </button>
      <button type="button" onClick={throwServerError}>
        Throw server test error
      </button>
      {serverErrorStatus ? <p>{serverErrorStatus}</p> : null}
    </div>
  );
}
