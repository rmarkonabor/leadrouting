import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

test.describe("Manual review", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("resolves an open manual review item", async ({ page }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/manual-review`);
    await expect(page.getByRole("heading", { name: "Manual review" })).toBeVisible();

    const items = page.locator("li", {
      has: page.getByRole("button", { name: "Resolve" }),
    });
    test.skip(
      (await items.count()) === 0,
      "No open manual review items in E2E_ORG_SLUG — see tests/e2e/README.md.",
    );

    const firstItem = items.first();
    await firstItem.getByRole("button", { name: "Resolve" }).click();
    await expect(firstItem).toBeHidden();
  });
});
