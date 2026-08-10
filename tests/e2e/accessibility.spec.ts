import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, missingE2eEnv } from "./env";

/**
 * Accessibility checks "where practical" per the Milestone 7 kickoff — run
 * against the pages built this milestone. Not a full WCAG audit (deferred
 * to pre-pilot alongside the rest of the Playwright scope), just a baseline
 * automated scan of each new page for the automatically-detectable subset
 * of issues (WCAG 2 A/AA rules axe-core covers).
 */
test.describe("Accessibility", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  for (const path of [
    "dashboard",
    "leads",
    "manual-review",
    "routing-health",
    "audit-logs",
  ]) {
    test(`/${path} has no automatically-detectable accessibility violations`, async ({
      page,
    }) => {
      await page.goto(`/org/${e2eEnv.orgSlug}/${path}`);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
