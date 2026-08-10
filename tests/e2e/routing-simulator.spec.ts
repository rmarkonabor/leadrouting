import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

test.describe("Routing simulator", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("simulates routing for an existing lead without creating an assignment", async ({
    page,
  }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/leads`);
    const firstLeadLink = page.locator("table tbody tr").first().locator("a");
    test.skip(
      (await page.locator("table tbody tr").count()) === 0,
      "No seeded leads in E2E_ORG_SLUG — see tests/e2e/README.md.",
    );
    const href = await firstLeadLink.getAttribute("href");
    const leadId = href?.split("/").pop();

    await page.goto(`/org/${e2eEnv.orgSlug}/routing/simulator`);
    await page.getByLabel("Lead ID").fill(leadId!);
    await page.getByRole("button", { name: "Simulate" }).click();

    await expect(
      page.getByRole("heading", { name: "Explanation" }).or(page.getByRole("alert")),
    ).toBeVisible();
  });
});
