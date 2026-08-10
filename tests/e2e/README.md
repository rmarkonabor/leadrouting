# End-to-end tests (Playwright)

Playwright is spec-scoped for Milestone 9 ("pre-pilot"), introduced early
at the Milestone 7 kickoff's explicit request for that milestone's new UI
surface (§"Milestone 7 slice" below), then extended to its full scope at
Milestone 9 itself (§"Milestone 9 critical journeys" below) — see
`docs/decisions.md` and `docs/testing-strategy.md` §3. These tests drive a
real running app against a real Supabase project — no mocks for
auth/RLS/routing — so, like `tests/integration`, they need real
prerequisites and are skipped automatically when those aren't present.

## Prerequisites

1. A running instance of the app (`npm run dev` or `npm run build && npm
start`) pointed at a Supabase project with all `supabase/migrations/`
   applied.
2. In that project: one organization, one `org_admin` member with a known
   password, and ideally at least one lead and one open manual review item
   (some journeys skip themselves with a clear reason when there's nothing
   to interact with, rather than failing).
3. Environment variables (only the first block is required; the rest each
   gate one specific Milestone 9 journey and that journey alone skips
   cleanly without them):
   ```
   E2E_BASE_URL=http://127.0.0.1:3000   # defaults to this if unset
   E2E_ORG_SLUG=your-test-org
   E2E_ADMIN_EMAIL=admin@example.test
   E2E_ADMIN_PASSWORD=...

   # intake-to-accept.spec.ts only: an active lead source's plaintext
   # token in E2E_ORG_SLUG, whose published routing flow can assign to
   # E2E_ADMIN_EMAIL (see that file's header comment).
   E2E_LEAD_SOURCE_TOKEN=...

   # cross-tenant-isolation.spec.ts only: a second, separate organization
   # and its own org_admin.
   E2E_ORG_B_SLUG=your-second-test-org
   E2E_ORG_B_ADMIN_EMAIL=admin-b@example.test
   E2E_ORG_B_ADMIN_PASSWORD=...
   ```

## Running

```
E2E_ORG_SLUG=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
```

Every spec calls `test.skip(...)` up front when the required env vars are
missing, so `npm run test:e2e` is safe to run without them — it just skips
everything, and is never invoked from CI for that reason (mirrors how
`tests/integration` skips without `TEST_DATABASE_URL`).

## Milestone 7 slice

- Dashboard: quick counts and links to the other main pages.
- Lead list: search producing an explicit empty state, clearing filters.
- Lead detail: viewing a lead, adding a note, changing its status.
- Manual review: resolving an open item.
- Routing simulator: running a simulation against an existing lead.
- Accessibility: an automated axe-core scan (WCAG 2 A/AA rules) of
  Dashboard, Lead list, Manual review, Routing health, and Audit logs —
  "where practical" per the kickoff, not a full manual audit.

## Milestone 9 critical journeys (docs/testing-strategy.md §3b)

1. **`org-invite-activate.spec.ts`** — admin invites a user, confirms it
   appears `invited` in the Users list. Organization creation itself has
   no UI (an org is bootstrapped once, outside the app); full activation
   requires clicking a real emailed invite link, which drives Supabase
   Auth's own hosted flow and can't be automated headlessly without a real
   inbox — both limitations are documented in the spec file itself.
2. **`team-territory-routing-publish.spec.ts`** — creates a team, a
   territory, a routing flow with one round-robin rule targeting that
   team, and publishes it.
3. **`intake-to-accept.spec.ts`** — posts directly to
   `POST /api/v1/intake/[sourceToken]`, then verifies the resulting lead's
   assignment status in the UI, and (only if routing happened to assign it
   to the admin session running the test) accepts the resulting
   notification and confirms the lead detail page reflects `accepted`.
4. **`expiration-reassignment.spec.ts`** — verifies the UI-visible result
   (an "expired" entry followed by a new "pending" entry in a lead's
   assignment history) on whatever lead in seed data has already been
   through a real expiration+reassignment cycle. Doesn't trigger expiration
   itself: that's driven by a Supabase Cron job with no HTTP route to force
   it on demand, and the transition itself is already covered directly
   against real Postgres in
   `tests/integration/milestone6-assignment-lifecycle.test.ts`.
5. **`manual-review-assignment.spec.ts`** — an admin manually assigns an
   open manual review item to a real user via the "Manually assign" form
   (distinct from `manual-review.spec.ts`'s "Resolve" button, which
   dismisses without assigning anyone).
6. **`cross-tenant-isolation.spec.ts`** — logs in as a second
   organization's own admin (not the shared `admin.json` storage state)
   and confirms visiting the first organization's leads/teams/routing
   pages surfaces only the same safe "that organization is unavailable"
   message, never real data.

Full role-permission scoping (agent/team_manager/org_admin visibility,
cross-org isolation) is covered exhaustively at the RLS layer in
`tests/integration` (e.g. `rls-tenant-isolation.test.ts`,
`milestone7-lead-interface.test.ts`) — the Playwright journeys above are
the UI-level confirmation that those guarantees actually surface
correctly to a real browser session, not a re-derivation of the same
coverage.
