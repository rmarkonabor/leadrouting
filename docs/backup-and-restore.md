# Backup and Restore

## Current status: no backups available (release blocking)

The linked Supabase project is on the **free tier**, which does not
include automatic backups or point-in-time recovery (PITR). This was
confirmed directly by the user, not assumed or inferred. As of this
document, **there is no way to recover from accidental data loss** —
whether from a bad migration, an operator mistake, a bug that deletes or
corrupts rows, or a Supabase-side incident.

This is listed as a release blocker in `docs/production-readiness.md` §21
and §31. It is not a gap this or any future engineering pass can close —
it requires upgrading the Supabase project's billing tier, which is a
business decision for the person responsible for that budget, not an
engineering task.

## Why this matters concretely

Every safeguard this system has against data loss is _preventive_, not
_recoverable_:

- Row Level Security and server-side authorization prevent most
  accidental/unauthorized writes, but don't undo one that gets through.
- Routing/assignment history is immutable once created (CLAUDE.md rule 19) — but immutability only protects against future mutation, not
  against a `DELETE` or a destructive migration run against the wrong
  table.
- `audit_logs`/`activities` provide a record of _what happened_, but
  replaying that record is not the same as restoring a consistent
  database snapshot, and doesn't exist for every table.

If a real customer's leads, routing configuration, or assignment history
were lost today, there is no backup to restore from. This is the honest
current state.

## What upgrading would provide

Supabase's paid tiers (Pro and above, as of writing) include:

- Daily automatic backups, retained for a rolling window (7 days on Pro;
  longer on higher tiers).
- Point-in-time recovery (PITR) on higher tiers, allowing restoration to
  any specific timestamp within the retention window, not just the most
  recent daily snapshot.

**Action needed from the user**: decide whether to upgrade before real
customer data enters the system, given the risk above. If the decision is
to proceed anyway on the free tier, that should be an explicit, informed,
documented choice — not an oversight.

## If/when backups exist: restore procedure

This section documents what the restore process _would_ look like once a
paid tier with backups is active — write this once backups actually exist
and are verified to work, don't treat this as untested documentation:

1. **Identify the target restore point** — the timestamp (for PITR) or
   the daily snapshot closest to before the incident occurred.
2. **Restore via the Supabase dashboard** (Project Settings → Database →
   Backups), which creates a new project (or restores in place, depending
   on the plan) from that snapshot.
3. **Verify the restored data** before pointing the application at it —
   confirm row counts and spot-check a few organizations' data look
   correct.
4. **Re-point the application's Supabase connection** (env vars) at the
   restored project if the restore created a new project rather than
   restoring in place.
5. **Communicate to affected organizations** what time range of activity
   (if any) was lost between the restore point and the incident — this is
   almost always non-zero unless PITR restored to the exact moment before
   the incident.
6. **Write a postmortem** per `docs/incident-response.md` §6.

## Interim mitigation while there is no backup plan

Until backups are enabled, the closest thing to a safety net is:

- **The data export runbook** (`docs/data-export-and-deletion-runbook.md`
  §2) can be run periodically as a manual, informal backup — exporting
  every organization's tables to CSV. This is not a substitute for real
  backups (it's a point-in-time export, not restorable in place, and
  relies on someone remembering to run it), but it is strictly better than
  nothing if run regularly before backups are enabled.
- Treat every migration and every manual data-correction script with
  extra caution, per `docs/database-schema.md` §22 and
  `docs/incident-response.md` §4 — there is currently no undo.
