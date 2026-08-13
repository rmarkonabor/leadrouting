import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

/**
 * Critical journey 5 (docs/testing-strategy.md §3b): "An unroutable lead
 * lands in manual review and is manually assigned by an admin." Distinct
 * from `manual-review.spec.ts`'s "resolves an open manual review item"
 * (which dismisses/resolves without assigning anyone) — this journey
 * exercises the "Manually assign" form's actual assignment path.
 *
 * Needs any real user id in the organization to assign to — this journey
 * harvests one from the Users page's "User ID" column rather than
 * requiring a dedicated env var, since any valid org member demonstrates
 * the manual-assignment mechanism correctly.
 */
test.describe("Manual review: manual assignment", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("an admin manually assigns an open manual review item to a user", async ({
    page,
  }) => {
    await page.goto(`/org/${e2eEnv.orgSlug}/users`);
    const userIdCells = page.locator("table tbody tr td:first-child");
    const userCount = await userIdCells.count();
    test.skip(userCount === 0, "No organization members found to assign to.");
    const userId = (await userIdCells.first().textContent())?.trim();
    test.skip(!userId, "Could not read a user id from the Users table.");

    await page.goto(`/org/${e2eEnv.orgSlug}/manual-review`);
    await expect(page.getByRole("heading", { name: "Manual review" })).toBeVisible();

    const items = page.locator("li", {
      has: page.getByRole("button", { name: "Manually assign" }),
    });
    test.skip(
      (await items.count()) === 0,
      "No open manual review items in E2E_ORG_SLUG — see tests/e2e/README.md.",
    );

    const firstItem = items.first();
    await firstItem.getByPlaceholder("user UUID").fill(userId!);
    await firstItem.getByRole("button", { name: "Manually assign" }).click();

    await expect(firstItem).toBeHidden();
  });
});
