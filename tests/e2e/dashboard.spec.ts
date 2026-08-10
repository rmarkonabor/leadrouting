import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

test.describe("Dashboard", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("shows quick counts and links to the other main pages", async ({ page }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/dashboard`);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Leads/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Notifications/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Routing health" })).toBeVisible();
  });
});
