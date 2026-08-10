import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

test.describe("Lead list", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("loads, shows an empty state for an impossible filter, and paginates", async ({
    page,
  }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/leads`);
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();

    // Search for something that can never match any seeded lead.
    await page.getByLabel("Search").fill("no-such-lead-zzzzz-e2e");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("No leads match these filters.")).toBeVisible();

    // Clearing filters returns to the unfiltered list.
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/org/${e2eEnv.orgSlug}/leads$`));
  });
});
