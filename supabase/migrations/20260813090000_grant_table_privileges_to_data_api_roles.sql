-- Fixes a real, previously undetected bug: no prior migration ever granted
-- table-level privileges to the `authenticated`/`service_role` Postgres
-- roles for any table in this schema. Every table's actual data access has
-- relied entirely on Row Level Security policies, but RLS is not the first
-- gate Postgres checks — a role needs the underlying table-level GRANT
-- (SELECT/INSERT/UPDATE/DELETE) before its RLS policies are ever
-- evaluated. Without it, every query fails with "permission denied for
-- table X", regardless of how correct the RLS policy is.
--
-- Why this was invisible until now: Supabase historically auto-granted
-- newly created public-schema tables to the Data API roles
-- (`anon`/`authenticated`/`service_role`) as a platform-level behavior
-- outside any migration file. `supabase/config.toml`'s own
-- `auto_expose_new_tables` comment says this auto-exposure is "the new
-- cloud default" to NOT do this automatically, and the local CLI's
-- default (this setting left unset) already matches that — which is
-- exactly what caused every `tests/integration/*.test.ts` file to fail
-- with `permission denied for table ...` the first time this project's CI
-- actually ran `supabase start` + the integration suite together in
-- GitHub Actions (previously only exercised ad hoc against a
-- hand-provisioned Postgres instance in a local sandbox, where the same
-- gap was worked around manually and never captured in a migration file —
-- see tests/integration/README.md's "Milestone 9 tenant-isolation
-- re-verification" section, now corrected to point here).
--
-- Fix: grant table-level SELECT/INSERT/UPDATE/DELETE on every existing
-- table to `authenticated` and `service_role`, and set default privileges
-- so any table created by a future migration gets the same grants
-- automatically, without needing to remember it each time.
--
-- This does not weaken tenant isolation or role scoping. RLS remains the
-- actual enforcement layer — every table already has RLS enabled with
-- policies scoping exactly which rows and which commands are allowed per
-- role (see docs/security-model.md §1). Granting the coarse table-level
-- privilege only removes the "denied before RLS is even consulted" false
-- negative; a table with no UPDATE/DELETE policy (e.g. `audit_logs`,
-- which only has INSERT and SELECT policies) still denies those commands
-- for every row, because Postgres RLS denies any command with no matching
-- permissive policy, independent of the table-level grant. This is the
-- same layered GRANT + RLS model Supabase's own documentation recommends.
--
-- `anon` intentionally receives no table grants here: every pre-auth code
-- path (lead intake, inbound CRM webhooks) calls a `SECURITY DEFINER`
-- function via RPC rather than querying a table directly (see ADR-011,
-- ADR-055) — `SECURITY DEFINER` functions run with their owner's
-- privileges, not the caller's, so `anon` has no need for any table-level
-- grant at all. Confirmed by grepping every `createAnonSupabaseClient`
-- call site in `src/`: each one only ever calls `.rpc(...)`, never
-- `.from(...)`.

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to authenticated, service_role;
