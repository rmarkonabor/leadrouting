# Incident Response

What to do when something goes wrong in a deployed environment. This is a
Phase 1-appropriate runbook — not a 24/7 on-call program, since there is
no dedicated ops team yet. It exists so a single person (the one running
this pilot) has a checklist instead of improvising under pressure.

## 1. Detecting an incident

Signals to watch, in order of how fast they'll actually surface a problem:

1. **Sentry** — the primary signal. A real error reaches Sentry with
   `environment: production`, sanitized (per `docs/security-model.md`
   §7), tagged with `organization_id`/`lead_id`/etc. where relevant. Check
   Sentry's issue stream, not just wait for an alert (see
   `docs/production-readiness.md` §19 — alert rules must be confirmed
   configured).
2. **Vercel runtime logs/errors** — for issues that don't reach Sentry
   (e.g. a build failure, a timeout before the app code runs).
3. **A user report** — an org_admin or agent reports something broken.
   Treat this as equally valid to an automated signal; Sentry doesn't
   catch everything (e.g. a UI that renders wrong but doesn't throw).
4. **Supabase project dashboard** — database-level issues (connection
   exhaustion, query errors, the project itself becoming unavailable).

## 2. Triage

1. **Is this affecting one organization or all of them?** Check the
   error's `organization_id` tag (if present) or ask the reporting user.
   A single-org issue is lower urgency than a platform-wide one.
2. **Is this a data-integrity issue or an availability issue?** An
   assignment going to the wrong person, or a lead losing data, is more
   urgent than a page being slow — the routing/assignment invariants
   (CLAUDE.md rule 19: routing/assignment history is immutable once
   created) mean a data-integrity bug can't be silently "fixed" after the
   fact, only mitigated going forward.
3. **Is this caused by a recent deploy?** Check the deploy timeline in
   Vercel against when the issue started. If yes, rollback (§4) is almost
   always the fastest mitigation — investigate the root cause afterward,
   not before, unless rollback itself is unsafe (e.g. a migration that
   can't be un-applied without another migration).
4. **Does this involve personal data exposure (a real cross-tenant leak,
   not just an internal bug)?** If yes, this is the highest-severity
   category — see §5.

## 3. Communication

- For a single-org issue: notify that organization's admin directly once
  you understand what happened and whether their data was affected.
- For a platform-wide issue: a brief status update is better than
  silence, even if the update is "we're aware and investigating."
- Never speculate about root cause publicly before confirming it — say
  what's observed, not what's guessed.

## 4. Mitigation

**App-code issue (no migration involved):**

1. Roll back via Vercel: "Promote to Production" the last known-good
   deployment, or redeploy that commit. This is faster and safer than
   trying to hot-fix under pressure.
2. Confirm the rollback resolved the symptom (repeat the smoke checks
   from `docs/deployment-runbook.md` §3.4-3.5).

**Migration/data issue:**

1. **Never hand-edit the linked database directly to "fix" data**
   (CLAUDE.md rule 9/10) — any correction is a new, reviewed forward
   migration or a deliberate, documented, approved one-off script, never
   an ad hoc `UPDATE` run under pressure without review.
2. If a bad migration was just applied and hasn't been widely used yet, a
   corrective forward migration (per `docs/database-schema.md` §22) is
   the only path — there is no automatic "down" migration against a
   linked project.
3. If real data was corrupted and there is no backup to restore from (see
   `docs/backup-and-restore.md` — this is the current reality on the free
   tier), the mitigation is limited to: stop the bleeding (fix the code/
   migration causing it), assess exactly what was affected using
   `audit_logs`/`activities` (which are themselves append-only and
   therefore a reliable record of what happened), and communicate
   honestly with affected organizations about what's recoverable and what
   isn't.

**Suspected cross-tenant data exposure:**

1. Treat as the highest priority — see §5.
2. Identify the affected organizations precisely (don't guess broader or
   narrower than the actual blast radius).
3. If the cause is a specific code path (like the manual-assignment gap
   found in this audit, `docs/decisions.md` ADR-058), disable that
   specific feature (e.g. via a targeted code change removing the UI
   entry point) rather than a full rollback, if a full rollback would lose
   unrelated fixes.

## 5. Cross-tenant exposure — special handling

This category gets escalated handling because it's the one class of
incident this system's entire security model (`docs/security-model.md`)
exists to prevent, and Phase 1 has no automated way to know its full
blast radius after the fact beyond `audit_logs`/`activities`.

1. Stop the exposure first (see §4).
2. Determine exactly what was exposed, to whom, and for how long, using
   `audit_logs` and `activities` — both are append-only, so they're a
   trustworthy record even mid-incident.
3. Notify every affected organization directly, not just the one that
   reported it, once the blast radius is known.
4. Write a postmortem (§6) regardless of severity — this category
   specifically should never be closed with just a code fix and no
   retrospective.

## 6. Postmortem

For any incident beyond a trivial, instantly-rolled-back one:

1. What happened, in plain language.
2. Root cause (not just the symptom).
3. Who/what was affected, and for how long.
4. What fixed it.
5. What would have caught this earlier (a missing test? a missing
   alert? a gap in this very runbook?) — and whether that gap was
   actually closed, not just noted.

Record this in `docs/decisions.md` if the root cause reveals an
architectural gap (matching the existing ADR pattern used throughout this
project), even outside a regular milestone.
