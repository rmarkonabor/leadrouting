import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

/**
 * Critical journey 4 (docs/testing-strategy.md §3b): "An assignment is
 * left unanswered past its deadline, expires, and is reassigned to the
 * next eligible agent."
 *
 * Expiration is driven by `run_expire_assignments`, a Supabase Cron job
 * (docs/background-processing.md) — there is no HTTP route this suite can
 * call to force it to run, and waiting out a real acceptance deadline
 * (minutes, per routing flow config) inside a Playwright test would make
 * the suite slow and flaky for no real coverage gain over the SQL-level
 * test that already exists
 * (`tests/integration/milestone6-assignment-lifecycle.test.ts`, which
 * covers exactly this transition against real Postgres). This journey
 * instead verifies the UI-visible *result* of that transition on whatever
 * lead in the seed data has already been through it — skipping cleanly if
 * none has, the same pattern used by manual-review.spec.ts for "no open
 * items yet."
 */
test.describe("Expiration and reassignment (UI-visible result)", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("a lead with an expired assignment shows both the expiration and the reassignment in its history", async ({
    page,
  }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/leads`);
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();

    const leadLinks = page.locator("main a[href*='/leads/']");
    const linkCount = await leadLinks.count();
    test.skip(linkCount === 0, "No leads in E2E_ORG_SLUG — see tests/e2e/README.md.");

    let found = false;
    for (let i = 0; i < linkCount; i++) {
      await leadLinks.nth(i).click();
      const historyText = await page
        .locator("main")
        .filter({ hasText: "Assignment history" })
        .first()
        .textContent();
      if (historyText?.includes("expired") && historyText.includes("pending")) {
        found = true;
        await expect(page.getByText(/expired/)).toBeVisible();
        break;
      }
      await page.goBack();
      await page.waitForLoadState("networkidle");
    }

    test.skip(
      !found,
      "No lead in E2E_ORG_SLUG has an expired-then-reassigned assignment history yet — " +
        "see this file's own header comment for why expiration isn't triggered directly.",
    );
  });
});
