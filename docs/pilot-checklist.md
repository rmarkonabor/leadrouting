# Pilot Checklist

Condensed go/no-go checklist before letting real customer data into the
application. Derived from `docs/production-readiness.md` — that document
has the full reasoning and evidence behind every line here; this is the
short version to actually work through.

## Release blockers — must all be checked before go-live

- [x] Apply `20260813100000_validate_manual_assignment_org_membership.sql`
      to the linked Supabase project (fixes a real cross-tenant
      authorization gap — `docs/production-readiness.md` §4). Applied,
      per user confirmation.
- [x] Confirm `20260813090000_grant_table_privileges_to_data_api_roles.sql`
      is applied — the user confirmed this earlier. Still worth a real
      authenticated read/write smoke test before pilot traffic (§20).
- [x] Decide on the database backups gap: upgrade the Supabase project
      tier, or explicitly and knowingly accept zero recovery capability
      (§21, `docs/backup-and-restore.md`). **Decided: zero recovery
      accepted for now.** Revisit before scaling past a small trusted pilot.
- [x] Confirm whether development/preview/production use genuinely
      separate Supabase projects, not the same one (§29). **Confirmed
      separate** — user verified `NEXT_PUBLIC_SUPABASE_URL` differs
      between Production and Preview/Development in the Vercel dashboard.

All release blockers are now checked off.

## High/Medium priority — should be done, not a hard technical gate

- [ ] Confirm at least one Sentry alert rule exists (new issue, or
      error-rate spike) so a production error doesn't go unnoticed (§19).
- [ ] Run the six Playwright critical journeys against a real preview
      deployment, or walk them by hand (§30, `tests/e2e/README.md`).
- [ ] Confirm a Preview deployment builds and serves correctly for the
      branch about to go to production.

## Verified — no action needed (for reference, not to re-check)

- Tenant isolation, Row Level Security, server authorization (aside from
  the fixed gap above), secret handling, publishable/secret key
  separation, routing transactions, assignment uniqueness, round-robin
  concurrency (fixed), queue/cron idempotency, webhook signatures, replay
  protection, CRM duplicate prevention, PII exclusion from logs/Sentry,
  source map hardening (fixed), migration reversibility, data
  export/deletion runbooks, rate limiting, input validation, audit logs,
  and dependency vulnerabilities (0 found) were all audited and found
  sound or already fixed. See `docs/production-readiness.md` §§1-27 for
  the evidence behind each.

## Before every future migration or major change (ongoing discipline, not one-time)

- [ ] Migration reviewed against `docs/database-schema.md` §22 (additive
      by default; destructive changes isolated and reviewer-acknowledged).
- [ ] Full quality gates pass: format, lint, typecheck, unit tests,
      integration tests, build.
- [ ] If the change touches routing/assignments: the six release-blocking
      routing tests (`docs/testing-strategy.md` §2) still pass.
- [ ] If the change touches a new table: confirm RLS is enabled and the
      new table is covered by the `authenticated`/`service_role` grants
      (either via the `ALTER DEFAULT PRIVILEGES` set in
      `20260813090000_grant_table_privileges_to_data_api_roles.sql`, which
      should cover it automatically, or verified explicitly if not).

## Final sign-off

This checklist is not "ready" until every item in the first section
(release blockers) is checked. Do not point real customer data at this
system before then, per the explicit instruction that started this audit.
