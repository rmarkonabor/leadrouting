import { notFound } from "next/navigation";
import { areSentryTestRoutesEnabled } from "@/lib/sentry/test-routes";
import { SentryTestButtons } from "./sentry-test-buttons";

/**
 * Development/Preview-only page for manually verifying Sentry capture end
 * to end (spec §47 requirement 13). See docs/setup.md for the exact
 * verification steps this page supports.
 */
export default function SentryExamplePage() {
  if (!areSentryTestRoutesEnabled()) {
    notFound();
  }

  return (
    <main>
      <h1>Sentry test page</h1>
      <p>Development and Preview only — not reachable in a real production deployment.</p>
      <SentryTestButtons />
    </main>
  );
}
