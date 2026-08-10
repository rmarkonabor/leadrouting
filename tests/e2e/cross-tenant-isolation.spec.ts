import { test, expect } from "@playwright/test";
import { e2eEnv, missingOrgBEnv } from "./env";

/**
 * Critical journey 6 (docs/testing-strategy.md §3b): "Cross-tenant check:
 * a second organization's admin cannot see the first organization's leads,
 * teams, or routing flows through the UI."
 *
 * Full role-permission/cross-org scoping is already covered exhaustively
 * at the RLS layer in `tests/integration` (e.g.
 * `rls-tenant-isolation.test.ts`, `milestone7-lead-interface.test.ts`'s
 * "no role can read another organization's leads"). This journey is the
 * UI-level confirmation that those RLS guarantees actually surface as
 * "nothing here" rather than a crash or, worse, a leak, when a real
 * second-organization admin session hits org A's pages directly.
 *
 * Starts from a signed-out state (not the shared admin.json storage state)
 * and logs in as org B's own admin, since this journey needs a session
 * that belongs to a different organization than every other spec in this
 * suite.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Cross-tenant isolation through the UI", () => {
  test.beforeEach(() => {
    const missing = missingOrgBEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("org B's admin sees no data when visiting org A's leads/teams/routing pages", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(e2eEnv.orgBAdminEmail!);
    await page.getByLabel("Password").fill(e2eEnv.orgBAdminPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    for (const path of ["leads", "teams", "routing"]) {
      await page.goto(`/org/${e2eEnv.orgSlug}/${path}`);
      // Server-side membership resolution (docs/security-model.md §1,
      // `getCurrentOrganization`) rejects a slug the caller has no active
      // membership in before any tenant data is touched, surfacing the
      // same safe, generic message every time — never org A's real leads,
      // teams, or routing flows, and never a stack trace.
      await expect(page.locator("main")).toContainText(
        "That organization is unavailable.",
      );
    }

    // The org B admin's own dashboard, by contrast, must work normally —
    // this isn't a broken session, just correctly scoped.
    await page.goto(`/org/${e2eEnv.orgBSlug}/dashboard`);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
