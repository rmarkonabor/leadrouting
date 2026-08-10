import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright is spec-scoped for Milestone 9 ("pre-pilot"), introduced early
 * here at the Milestone 7 kickoff's explicit request — see
 * docs/decisions.md and docs/testing-strategy.md. These tests exercise the
 * real running app against a real Supabase project (no mocks for RLS/auth,
 * same reasoning as tests/integration's real-Postgres approach), so they
 * need a seeded organization and test users — see tests/e2e/README.md.
 * They are not part of `npm test` / CI; run explicitly with `npm run
 * test:e2e` once the prerequisites in that README are met.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
});
