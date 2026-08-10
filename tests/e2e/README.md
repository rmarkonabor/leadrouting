# End-to-end tests (Playwright)

Playwright is spec-scoped for Milestone 9 ("pre-pilot"), introduced early
here at the Milestone 7 kickoff's explicit request — see
`docs/decisions.md` and `docs/testing-strategy.md`. These tests drive a
real running app against a real Supabase project — no mocks for
auth/RLS/routing — so, like `tests/integration`, they need real
prerequisites and are skipped automatically when those aren't present.

## Prerequisites

1. A running instance of the app (`npm run dev` or `npm run build && npm
start`) pointed at a Supabase project with the Milestone 1-7 migrations
   applied.
2. In that project: one organization, one `org_admin` member with a known
   password, and ideally at least one lead and one open manual review item
   (some journeys skip themselves with a clear reason when there's nothing
   to interact with, rather than failing).
3. Environment variables:
   ```
   E2E_BASE_URL=http://127.0.0.1:3000   # defaults to this if unset
   E2E_ORG_SLUG=your-test-org
   E2E_ADMIN_EMAIL=admin@example.test
   E2E_ADMIN_PASSWORD=...
   ```

## Running

```
E2E_ORG_SLUG=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
```

Every spec calls `test.skip(...)` up front when the required env vars are
missing, so `npm run test:e2e` is safe to run without them — it just skips
everything, and is never invoked from CI for that reason (mirrors how
`tests/integration` skips without `TEST_DATABASE_URL`).

## What is covered

- Dashboard: quick counts and links to the other main pages.
- Lead list: search producing an explicit empty state, clearing filters.
- Lead detail: viewing a lead, adding a note, changing its status.
- Manual review: resolving an open item.
- Routing simulator: running a simulation against an existing lead.
- Accessibility: an automated axe-core scan (WCAG 2 A/AA rules) of
  Dashboard, Lead list, Manual review, Routing health, and Audit logs —
  "where practical" per the kickoff, not a full manual audit.

Full role-permission scoping (agent/team_manager/org_admin visibility,
cross-org isolation) is covered at the RLS layer in
`tests/integration/milestone7-lead-interface.test.ts`, not duplicated here.
