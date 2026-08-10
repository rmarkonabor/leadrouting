# Production Readiness (Milestone 9)

Per `docs/implementation-plan.md` Milestone 9's definition of done: "all
release-blocking tests pass; no unresolved critical security issue
remains; preview deployments work; Sentry receives production-style
errors with no personal information; database migrations have been
reviewed against the reversibility policy; pilot customers can be
onboarded safely; all quality gates pass." This document is the single
place that status is recorded, honestly — including the items that are
still open and need the user's action, not glossed over as done.

## 1. Automated verification completed this milestone

| Item                                                       | Status                                                       | Where                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration reversibility review (all 11 migration files)    | Done                                                         | `docs/database-schema.md` §22.1                                                                                                                             |
| CI: integration tests + dependency vulnerability scan      | Done                                                         | `.github/workflows/ci.yml`                                                                                                                                  |
| Security review against `security-model.md` §9 known risks | Done                                                         | `docs/security-model.md` §9.1, §7.1                                                                                                                         |
| Tenant isolation review (full suite, one shared database)  | Done — 60/60 tests passing together                          | `tests/integration/README.md` "Milestone 9 tenant-isolation re-verification"                                                                                |
| Concurrency review (higher parallelism)                    | Done — **found and fixed a real round-robin race condition** | `docs/decisions.md` ADR-056, `supabase/migrations/20260813080000_milestone9_routing_state_race_fix.sql`, `tests/integration/milestone9-concurrency.test.ts` |
| Sentry sanitization pass (production-shaped events)        | Done                                                         | `docs/security-model.md` §7.1, `tests/unit/sentry-sanitize.test.ts`                                                                                         |
| Data export and deletion runbooks                          | Done                                                         | `docs/data-export-and-deletion-runbook.md`                                                                                                                  |
| Playwright critical journeys (all 6, automated)            | Done                                                         | `tests/e2e/README.md` "Milestone 9 critical journeys"                                                                                                       |
| Full quality gates (format/lint/typecheck/test/build)      | Done                                                         | this milestone's own commits                                                                                                                                |

## 2. Backups — known, accepted gap (confirmed by the user)

**Status: not available.** The linked Supabase project is on the free
tier, which does not include automatic backups or point-in-time recovery
(PITR) — this was confirmed directly by the user during this milestone,
not assumed. Spec §52 item 16 ("database backups") is therefore **not
met** on the current project tier.

- No workaround is implemented in Phase 1 code — there is no application-
  level backup mechanism, and building one would be exactly the kind of
  unapproved scope CLAUDE.md rule 3 exists to prevent.
- The only real mitigation is upgrading the Supabase project to a paid
  tier with backups/PITR enabled, which is a billing/business decision for
  the user to make, not an engineering task.
- Until that happens, any data-loss incident (accidental deletion, a bad
  migration, a provider-side incident) has **no recovery path**. This risk
  is accepted and documented here rather than hidden — see
  `docs/security-model.md` §9's known-risks table for the corresponding
  row.

**Action needed from the user**: decide whether to upgrade the Supabase
project tier before real pilot traffic, given this gap.

## 3. Separate development/preview/production environments — needs confirmation

Spec §52 item 17 requires separate dev/preview/production environments and
env var sets, "actually configured in Vercel + Supabase, not just
documented." `docs/setup.md` §6 documents _how_ to configure Sentry env
vars per-environment in Vercel, and the codebase's own env validation
(`src/lib/env`) supports different values per environment, but this
milestone has not independently verified that:

- A separate Supabase project (or at minimum a separate schema/branch)
  exists for local/preview vs. the production project, so preview
  deployments and pilot data never share a database.
- Vercel's environment variables are actually scoped per-environment
  (Development / Preview / Production checkboxes on each variable), not
  all set to the same values.

**Action needed from the user**: confirm this is actually configured, or
have it configured, before pilot traffic. This cannot be verified from
inside this session — it requires looking at the real Vercel and Supabase
project dashboards.

## 4. Sentry — needs a real verification pass

`docs/setup.md` §6 has full walkthrough instructions
(get credentials → add to Vercel → deploy a preview → trigger a real
browser and server error → confirm they arrive in Sentry with source maps
and zero personal fields). This milestone's sanitizer review
(§7.1 above) confirms the _code_ strips personal data correctly against
representative event shapes, but per the Milestone 9 plan's own manual-
verification step, someone still needs to:

1. Confirm a real Sentry DSN is configured in Vercel (not left as a
   placeholder).
2. Trigger a real browser and server error against a real preview
   deployment and confirm both arrive in the Sentry dashboard with
   `environment: preview`, readable stack traces, and no personal fields
   (name, email, phone, address, message, consent text, custom variable
   values) anywhere in the event.

**Action needed from the user**: run through `docs/setup.md` §6.3–§6.6
once against a real preview deployment, or confirm it was already done.

## 5. Playwright critical journeys — automated, manual walk still pending

All six critical journeys (`docs/testing-strategy.md` §3b) are now
automated in `tests/e2e/` (see §1 above and `tests/e2e/README.md`). Per
the Milestone 9 plan's own manual-verification step ("walk all six
Playwright critical journeys manually once against a preview deployment
before automating them, to catch anything the script wouldn't"), a human
should still walk all six by hand at least once against a real preview
deployment — automation catches regressions, not the first-time UX
issues a script wasn't written to notice.

**Action needed from the user**: either walk the six journeys manually
(dashboard → invite → team/territory/flow → intake → notification →
manual review → cross-org check, using two real organizations), or
explicitly delegate that walkthrough and report back what was found.

## 6. Vercel Preview / Production deployment

**Verified directly against the real Vercel project's deployment
history** (`leadrouting`, via the Vercel API), not assumed:

- **Preview deployments for branches: confirmed.** Every push to a
  `milestone/*` feature branch in this project's history produced its own
  deployment with a branch-scoped alias (e.g.
  `leadrouting-git-milestone-09-produ-...vercel.app`) and `target: null`
  (Vercel's Preview classification) — this happened automatically through
  the GitHub integration for every one of Milestones 5 through 9's
  branches, with no manual trigger.
- **Production deployment restricted to the production branch: confirmed.**
  Every deployment in this project's history with `target: "production"`
  has `githubCommitRef: "main"` — there is no example of a
  `target: "production"` deployment originating from any other branch.
  This is enforced by the Vercel project's own **Production Branch**
  setting (Project Settings → Git), currently `main`, not by anything in
  this repository's GitHub Actions workflow.
- **Production deployment is explicitly not part of this milestone's
  verification**, per CLAUDE.md rule 13 and the Milestone 9 plan's own
  text: "do not actually deploy to production as part of this milestone's
  verification unless the user explicitly approves it." No production
  deploy has been made or requested as part of this work.
- **Observation, not something this session investigated or fixed**:
  several of the historical `target: "production"` deployments in this
  project ended in `state: "ERROR"`. Diagnosing/fixing that is outside
  this CI/deployment-safety-checks scope ("implement CI checks only") —
  flagged here so it isn't missed before relying on production deploys
  working cleanly.

**Action needed from the user**: confirm a Preview deployment for this
branch builds and serves correctly, and give explicit approval before any
production deploy. See `docs/branch-protection.md` for the required
GitHub-side branch protection settings (separate from, and complementary
to, Vercel's own production-branch restriction described above).

## 7. Concurrency fix — read this before merging

This milestone's concurrency review found and fixed a genuine bug (not a
test artifact): `compute_routing_decision`'s round-robin locking took no
lock on the very first assignment ever made for a team+flow, because
`SELECT ... FOR UPDATE` against zero matching rows locks nothing. Under
real concurrent load this could produce two candidates being awarded the
"first" round-robin slot simultaneously. See `docs/decisions.md` ADR-056
for the full root cause and fix
(`supabase/migrations/20260813080000_milestone9_routing_state_race_fix.sql`).
This migration must be applied to the linked project the same way every
other migration is (`supabase db push` or the SQL Editor — see CLAUDE.md
rule 10; this session cannot apply it directly).

## 7a. URGENT: missing table-level grants — likely affects the live app right now

While wiring up real CI (turning on `supabase start` + the integration
suite in actual GitHub Actions for the first time), every integration
test failed with `permission denied for table ...`. Root cause: **no
migration across Milestones 1–9 ever granted table-level privileges to
the `authenticated` Postgres role** — every table's access has relied
entirely on RLS policies, but Postgres checks the table-level `GRANT`
before it ever evaluates an RLS policy. `supabase/config.toml`'s own
`auto_expose_new_tables` setting confirms this isn't a CI-only quirk:
newly created tables are **not** auto-exposed to
`anon`/`authenticated`/`service_role` by default anymore ("the new cloud
default") — a behavior Supabase used to provide automatically and no
longer does. See `docs/decisions.md` ADR-057 for full detail.

**This most likely means the currently-linked Supabase project has the
same gap**, since it was set up the same way (migrations only, no manual
grants) — if so, every authenticated user of the deployed app is
currently getting `permission denied` on ordinary reads/writes, not just
this session's CI run.

**Fix**: `supabase/migrations/20260813090000_grant_table_privileges_to_data_api_roles.sql`
grants the missing privileges and sets default privileges for future
tables. **This should be applied to the linked project immediately**,
independent of whether the rest of this PR chain has merged — it is
purely additive (no table/column/constraint change) and does not weaken
tenant isolation (RLS is still the real enforcement layer; see ADR-057
for why `audit_logs`'s missing UPDATE/DELETE policy, for example, still
blocks those commands regardless of this grant).

**Action needed from the user**: apply this migration to the linked
project as soon as possible, and if the app is already live for real
users, verify with a real authenticated request that basic reads/writes
(e.g. loading the dashboard, viewing a lead) actually work — this may
explain any "permission denied" reports if the app has been in use.

## 8. Manual verification checklist (for the user / whoever runs this before pilot)

- [ ] Decide on the Supabase free-tier backups gap (§2) — accept the risk
      or upgrade the project tier.
- [ ] Confirm separate dev/preview/production environments and env vars
      are actually configured, not just documented (§3).
- [ ] Confirm a real Sentry DSN is configured and verify a real error
      reaches it with zero personal fields (§4).
- [ ] Walk all six Playwright critical journeys by hand against a preview
      deployment (§5).
- [ ] Confirm a Preview deployment for this branch builds and serves
      correctly.
- [ ] **Urgent** — apply
      `20260813090000_grant_table_privileges_to_data_api_roles.sql` to the
      linked project (§7a) and confirm real authenticated reads/writes
      work; this may already be causing `permission denied` errors for
      real users of the deployed app.
- [ ] Apply `20260813080000_milestone9_routing_state_race_fix.sql` (and
      every other pending migration) to the linked project.
- [ ] Explicitly approve before any production deployment (CLAUDE.md
      rule 13) — not implied by any of the above.

## 9. Definition of done — self-assessment

| Criterion                                                            | Met?                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All release-blocking tests pass                                      | Yes — all 6 (§54) pass, including the concurrency fix                                                                                                                         |
| No unresolved critical security issue remains                        | Yes, within this milestone's own scope — see §9.1 re-verification in `security-model.md`. The backups gap (§2) is a known, accepted operational limitation, not a code defect |
| Preview deployments work                                             | Not verified in this session — needs the user (§6)                                                                                                                            |
| Sentry receives production-style errors with no personal information | Code-level: yes (§1). Live verification: needs the user (§4)                                                                                                                  |
| Database migrations reviewed against the reversibility policy        | Yes — `docs/database-schema.md` §22.1                                                                                                                                         |
| Pilot customers can be onboarded safely                              | Conditional on §8's checklist being completed by the user first                                                                                                               |
| All quality gates pass                                               | Yes — format/lint/typecheck/unit+integration tests/build all green as of this milestone's commits                                                                             |
