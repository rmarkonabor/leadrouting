/**
 * Required env vars for the Playwright suite (tests/e2e/README.md).
 * Every spec file reads `e2eEnv` and calls `test.skip(...)` up front when
 * any prerequisite is missing, mirroring the `describe.skipIf(!TEST_DATABASE_URL)`
 * pattern already used in tests/integration.
 */
export const e2eEnv = {
  orgSlug: process.env.E2E_ORG_SLUG,
  adminEmail: process.env.E2E_ADMIN_EMAIL,
  adminPassword: process.env.E2E_ADMIN_PASSWORD,
  // Milestone 9 critical journeys (docs/testing-strategy.md §3b) — optional,
  // each guards only the specific spec(s) that need it.
  leadSourceToken: process.env.E2E_LEAD_SOURCE_TOKEN,
  orgBSlug: process.env.E2E_ORG_B_SLUG,
  orgBAdminEmail: process.env.E2E_ORG_B_ADMIN_EMAIL,
  orgBAdminPassword: process.env.E2E_ORG_B_ADMIN_PASSWORD,
};

export function missingE2eEnv(): string | null {
  if (!e2eEnv.orgSlug || !e2eEnv.adminEmail || !e2eEnv.adminPassword) {
    return "Set E2E_ORG_SLUG, E2E_ADMIN_EMAIL, and E2E_ADMIN_PASSWORD to run this suite — see tests/e2e/README.md.";
  }
  return null;
}

export function missingLeadSourceEnv(): string | null {
  const base = missingE2eEnv();
  if (base) return base;
  if (!e2eEnv.leadSourceToken) {
    return "Set E2E_LEAD_SOURCE_TOKEN (an active lead source's plaintext token in E2E_ORG_SLUG) to run this journey — see tests/e2e/README.md.";
  }
  return null;
}

export function missingOrgBEnv(): string | null {
  const base = missingE2eEnv();
  if (base) return base;
  if (!e2eEnv.orgBSlug || !e2eEnv.orgBAdminEmail || !e2eEnv.orgBAdminPassword) {
    return "Set E2E_ORG_B_SLUG, E2E_ORG_B_ADMIN_EMAIL, and E2E_ORG_B_ADMIN_PASSWORD (a second organization) to run this journey — see tests/e2e/README.md.";
  }
  return null;
}
