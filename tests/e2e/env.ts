/**
 * Required env vars for the Milestone 7 Playwright suite (tests/e2e/README.md).
 * Every spec file reads `e2eEnv` and calls `test.skip(...)` up front when
 * any prerequisite is missing, mirroring the `describe.skipIf(!TEST_DATABASE_URL)`
 * pattern already used in tests/integration.
 */
export const e2eEnv = {
  orgSlug: process.env.E2E_ORG_SLUG,
  adminEmail: process.env.E2E_ADMIN_EMAIL,
  adminPassword: process.env.E2E_ADMIN_PASSWORD,
};

export function missingE2eEnv(): string | null {
  if (!e2eEnv.orgSlug || !e2eEnv.adminEmail || !e2eEnv.adminPassword) {
    return "Set E2E_ORG_SLUG, E2E_ADMIN_EMAIL, and E2E_ADMIN_PASSWORD to run this suite — see tests/e2e/README.md.";
  }
  return null;
}
