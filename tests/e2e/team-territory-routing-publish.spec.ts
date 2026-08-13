import { test, expect } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

/**
 * Critical journey 2 (docs/testing-strategy.md §3b): "Admin creates a
 * team, a territory, a routing flow, publishes it."
 */
test.describe("Team, territory, and routing flow setup + publish", () => {
  test.beforeEach(() => {
    const missing = missingE2eEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("creates a team, a territory, a routing flow with a rule, and publishes it", async ({
    page,
  }) => {
    const suffix = Date.now();
    const teamName = `E2E Team ${suffix}`;
    const territoryName = `E2E Territory ${suffix}`;
    const flowName = `E2E Flow ${suffix}`;

    await page.goto(`/org/${e2eEnv.orgSlug}/teams`);
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
    await page.getByLabel("Name").fill(teamName);
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByText(teamName, { exact: false })).toBeVisible();

    await page.goto(`/org/${e2eEnv.orgSlug}/territories`);
    await expect(page.getByRole("heading", { name: "Territories" })).toBeVisible();
    await page.getByLabel("Name").fill(territoryName);
    await page.getByLabel("Territory type").selectOption("country");
    await page.getByLabel(/^Value/).fill("US");
    await page.getByRole("button", { name: "Create territory" }).click();
    await expect(page.getByText(territoryName, { exact: false })).toBeVisible();

    await page.goto(`/org/${e2eEnv.orgSlug}/routing`);
    await expect(page.getByRole("heading", { name: "Routing" })).toBeVisible();
    await page.getByLabel("Name").fill(flowName);
    await page.getByRole("button", { name: "Create draft flow" }).click();

    const flowLink = page.getByRole("link", { name: flowName });
    await expect(flowLink).toBeVisible();
    await flowLink.click();

    await expect(page.getByRole("heading", { name: flowName })).toBeVisible();
    await expect(page.getByText("never published")).toBeVisible();

    await page.getByLabel("Name").fill("Round robin to " + teamName);
    await page.getByLabel("Team").selectOption({ label: teamName });
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText(teamName, { exact: false }).first()).toBeVisible();

    await page.getByRole("button", { name: "Publish current rules" }).click();
    await expect(page.getByText(/Published as version \d+\./)).toBeVisible();
    await page.reload();
    await expect(page.getByText("has a published version")).toBeVisible();
  });
});
