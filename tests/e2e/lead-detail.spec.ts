import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

test.describe("Lead detail", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("view a lead, add a note, and change its status", async ({ page }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/leads`);

    const firstLeadLink = page.locator("table tbody tr").first().locator("a");
    test.skip(
      (await page.locator("table tbody tr").count()) === 0,
      "No seeded leads in E2E_ORG_SLUG — see tests/e2e/README.md.",
    );
    await firstLeadLink.click();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();

    const noteText = `E2E note ${Date.now()}`;
    await page.getByLabel("Add a note").fill(noteText);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(noteText)).toBeVisible();

    await page.getByLabel("Lead status").selectOption("contacted");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Current: contacted")).toBeVisible();
  });
});
