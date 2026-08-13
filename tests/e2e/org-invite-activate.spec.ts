import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

/**
 * Critical journey 1 (docs/testing-strategy.md §3b): "Admin creates an
 * organization, invites a user, the invited user activates their account."
 *
 * Organization creation has no UI in Phase 1 (an org is bootstrapped once,
 * outside the app, per docs/decisions.md ADR-002/ADR-011) — E2E_ORG_SLUG is
 * that pre-created organization. This journey covers the two parts that do
 * have UI: the admin inviting a user, and the invite showing up as
 * `invited` in the Users list. Full activation (following the emailed
 * invite link, which drives Supabase Auth's own hosted flow rather than
 * anything this app renders) can't be driven headlessly without a real
 * inbox, so it isn't simulated here — this matches the honest limitation
 * already documented for other journeys in this suite.
 */
test.describe("Organization: invite a user", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("admin invites a new user and it appears as invited in the Users list", async ({
    page,
  }) => {
    const email = `e2e-invite-${Date.now()}@example.test`;

    await page.goto(`/org/${e2eEnv.orgSlug}/users`);
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    // The invited row's "User ID" column shows the auth user id, not the
    // email, so this journey asserts on the count of `invited`-status rows
    // increasing by exactly one, rather than matching the email directly.
    const invitedCountBefore = await page.getByRole("cell", { name: "invited" }).count();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role").selectOption("agent");
    await page.getByRole("button", { name: "Invite" }).click();

    await expect(page.getByRole("cell", { name: "invited" })).toHaveCount(
      invitedCountBefore + 1,
    );
  });
});
