-- Milestone 1 follow-up: address Supabase security advisor findings from
-- applying the foundation migration (docs/database-schema.md §22 — fix
-- forward with a new migration rather than editing the applied one).
--
-- Findings:
--   1. set_updated_at() had no pinned search_path (function_search_path_mutable).
--   2. bootstrap_organization(), handle_new_auth_user(), and set_updated_at()
--      were directly EXECUTE-granted to `anon`/`authenticated` by Supabase's
--      default-privilege template at CREATE FUNCTION time, before the
--      original migration's `revoke all ... from public` ran — revoking
--      from PUBLIC does not remove a separate direct grant to a named role.
--      bootstrap_organization() being anon-executable meant the unauthenticated
--      role could reach the RPC endpoint at all (the function's own
--      `auth.uid() is null` check still blocked it, but the grant itself
--      should not exist — defense in depth per docs/security-model.md).
--   3. handle_new_auth_user() and set_updated_at() are trigger-only functions
--      that no client should ever call directly via PostgREST RPC; revoking
--      all role grants does not break their triggers (trigger firing does
--      not require the firing session to hold EXECUTE on the trigger
--      function).

-- Pin search_path on every SECURITY DEFINER-adjacent helper.
alter function public.set_updated_at() set search_path = public;

-- Trigger-only functions: remove all client-callable grants. Triggers still
-- fire correctly — Postgres does not check EXECUTE privilege for the
-- invoking session when a function runs as part of trigger execution.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- bootstrap_organization: authenticated callers only, never anon. The
-- function's own auth.uid() check already blocks unauthenticated callers,
-- but the grant itself should not exist.
revoke all on function public.bootstrap_organization(text, text) from public, anon;
grant execute on function public.bootstrap_organization(text, text) to authenticated;
