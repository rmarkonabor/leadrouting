-- Milestone 1: Foundation
-- Organizations, organization membership, roles, and tenant isolation.
-- See docs/database-schema.md §1 and docs/security-model.md §1.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared trigger function that stamps updated_at on every mutating table.';

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create type public.organization_status as enum ('active', 'suspended');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.organization_status not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_unique unique (slug)
);

comment on table public.organizations is
  'One row per customer account (tenant). Root of the tenant boundary.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_users (membership + role)
-- ---------------------------------------------------------------------------

create type public.organization_role as enum ('org_admin', 'team_manager', 'agent');
create type public.organization_user_status as enum ('invited', 'active', 'inactive', 'suspended');

create table public.organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'agent',
  status public.organization_user_status not null default 'invited',
  invited_by_user_id uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_users_org_user_unique unique (organization_id, user_id)
);

comment on table public.organization_users is
  'Membership + role of a user within an organization. A user may belong to '
  'multiple organizations; role and status are always evaluated per-membership, '
  'never globally. This table is the sole source of truth for tenant access checks.';

create index organization_users_organization_id_idx on public.organization_users (organization_id);
create index organization_users_user_id_idx on public.organization_users (user_id);
create index organization_users_org_active_idx
  on public.organization_users (organization_id, user_id)
  where status = 'active';

create trigger organization_users_set_updated_at
  before update on public.organization_users
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_profiles (one row per Supabase Auth user; NOT tenant-owned, since a
-- person can belong to multiple organizations)
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  default_organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Cross-organization identity data for a Supabase Auth user. Deliberately not '
  'tenant-owned (has no organization_id) per docs/database-schema.md §1.';

create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row
  execute function public.set_updated_at();

-- Auto-create a user_profiles row whenever a new auth user is created, so the
-- application never has to special-case a missing profile row.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_users enable row level security;
alter table public.user_profiles enable row level security;

-- organizations: visible only to active members of that organization.
-- Deliberately re-checks live membership on every query rather than trusting
-- a JWT claim, per docs/security-model.md §1 / docs/decisions.md ADR-006.
create policy organizations_select_active_member
  on public.organizations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = organizations.id
        and ou.user_id = (select auth.uid())
        and ou.status = 'active'
    )
  );

-- Only an active org_admin may update organization settings.
create policy organizations_update_org_admin
  on public.organizations
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = organizations.id
        and ou.user_id = (select auth.uid())
        and ou.status = 'active'
        and ou.role = 'org_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = organizations.id
        and ou.user_id = (select auth.uid())
        and ou.status = 'active'
        and ou.role = 'org_admin'
    )
  );

-- Organization creation happens only through the bootstrap_organization()
-- SECURITY DEFINER function below, never via a direct client-side insert, so
-- no direct INSERT policy is granted to authenticated users on this table.

-- organization_users: a member can see the membership roster of any
-- organization they are an active member of (needed to know who else is on
-- their team); org_admins can also update roles/status within their org.
create policy organization_users_select_fellow_member
  on public.organization_users
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_users self_ou
      where self_ou.organization_id = organization_users.organization_id
        and self_ou.user_id = (select auth.uid())
        and self_ou.status = 'active'
    )
  );

create policy organization_users_update_org_admin
  on public.organization_users
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_users admin_ou
      where admin_ou.organization_id = organization_users.organization_id
        and admin_ou.user_id = (select auth.uid())
        and admin_ou.status = 'active'
        and admin_ou.role = 'org_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.organization_users admin_ou
      where admin_ou.organization_id = organization_users.organization_id
        and admin_ou.user_id = (select auth.uid())
        and admin_ou.status = 'active'
        and admin_ou.role = 'org_admin'
    )
  );

-- user_profiles: a user may only read/update their own profile row. Cross-org
-- membership rosters never expose another user's profile in Phase 1 Milestone 1.
create policy user_profiles_select_self
  on public.user_profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy user_profiles_update_self
  on public.user_profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- bootstrap_organization: the only way an organization + its first org_admin
-- membership are created in Milestone 1. auth.uid() still reflects the real
-- caller even though the function runs SECURITY DEFINER (see below); it is a
-- single transaction so an organization is never created without its owning
-- membership row, and vice versa.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER is required here: with no INSERT policy granted to
-- `authenticated` on organizations/organization_users, a SECURITY INVOKER
-- version of this function would fail RLS just like a raw client insert
-- would. Running as definer lets this one audited, narrow function perform
-- both inserts atomically while raw client inserts remain impossible.
create or replace function public.bootstrap_organization(org_name text, org_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.organizations (name, slug)
  values (org_name, org_slug)
  returning * into new_org;

  insert into public.organization_users (organization_id, user_id, role, status, activated_at)
  values (new_org.id, caller_id, 'org_admin', 'active', now());

  return new_org;
end;
$$;

comment on function public.bootstrap_organization(text, text) is
  'Creates an organization and its first org_admin membership atomically. '
  'The only supported way to create an organization in Milestone 1 — there is '
  'no direct INSERT policy on organizations or organization_users for this path.';

revoke all on function public.bootstrap_organization(text, text) from public;
grant execute on function public.bootstrap_organization(text, text) to authenticated;
