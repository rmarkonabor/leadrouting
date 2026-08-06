-- Fix: infinite recursion in RLS policies on organizations/organization_users.
--
-- The foundation migration (20260805160000) predates the
-- is_active_org_member()/is_org_admin() SECURITY DEFINER helpers introduced
-- in Milestone 2, so its four policies inlined a raw
-- `exists (select 1 from organization_users ...)` subquery directly. Because
-- organization_users has RLS enabled, evaluating that inline subquery
-- re-invokes organization_users' own SELECT policy, which contains the same
-- subquery, which Postgres detects as unbounded recursion:
--   error: infinite recursion detected in policy for relation "organization_users"
--
-- This was never caught before because no earlier session had a real
-- Postgres available to execute these policies against — it was only
-- discovered running Milestone 5's real-database verification. It reproduces
-- on any authenticated query against organizations or organization_users,
-- including the read-your-own-organization path and any UPDATE to
-- organization_users (e.g. a non-admin agent attempting to self-promote,
-- which should just affect zero rows, not throw).
--
-- Fix: point all four policies at is_active_org_member()/is_org_admin(),
-- exactly as Milestone 2 already does for every other tenant table. Those
-- helpers are `security definer` functions owned by the migration-applying
-- role, which owns these tables — table owners bypass RLS on their own
-- tables, so the helper's internal query does not re-trigger the policy
-- it's being called from. See docs/decisions.md ADR-023 (already documents
-- the rationale for the helpers) and the new ADR added alongside this fix.
drop policy if exists organizations_select_active_member on public.organizations;
create policy organizations_select_active_member
  on public.organizations
  for select
  to authenticated
  using (public.is_active_org_member(id));

drop policy if exists organizations_update_org_admin on public.organizations;
create policy organizations_update_org_admin
  on public.organizations
  for update
  to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

drop policy if exists organization_users_select_fellow_member on public.organization_users;
create policy organization_users_select_fellow_member
  on public.organization_users
  for select
  to authenticated
  using (public.is_active_org_member(organization_id));

drop policy if exists organization_users_update_org_admin on public.organization_users;
create policy organization_users_update_org_admin
  on public.organization_users
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
