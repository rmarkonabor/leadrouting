import { test as setup } from "@playwright/test";
import { e2eEnv, missingE2eEnv } from "./env";

const authFile = "tests/e2e/.auth/admin.json";

setup("authenticate as org_admin", async ({ page }) => {
  const missing = missingE2eEnv();
  setup.skip(!!missing, missing ?? undefined);

  await page.goto("/login");
  await page.getByLabel("Email").fill(e2eEnv.adminEmail!);
  await page.getByLabel("Password").fill(e2eEnv.adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.context().storageState({ path: authFile });
});
