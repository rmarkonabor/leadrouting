-- Milestone 2: Organizations, users, roles, teams, availability, capacity,
-- and recipient attributes. See docs/database-schema.md §2-4/§17,
-- docs/security-model.md §1, docs/permissions-matrix.md.
--
-- Leads/routing are explicitly out of scope for this milestone (spec's
-- Milestone 2 boundary, docs/implementation-plan.md).

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER to avoid self-referencing RLS
-- recursion when a table's own policy needs to query that same table via one
-- of these helpers — e.g. team_users' policy calling
-- is_permitted_team_manager(), which itself queries team_users). Each helper
-- takes no attacker-controlled identity input (auth.uid() only), so running
-- as definer does not create a privilege-escalation path. See
-- docs/decisions.md ADR-023.
-- ---------------------------------------------------------------------------

create or replace function public.is_active_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_users ou
    where ou.organization_id = p_org_id
      and ou.user_id = auth.uid()
      and ou.status = 'active'
  );
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_users ou
    where ou.organization_id = p_org_id
      and ou.user_id = auth.uid()
      and ou.status = 'active'
      and ou.role = 'org_admin'
  );
$$;

revoke all on function public.is_active_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_active_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- is_permitted_team_manager is defined further below, immediately after the
-- team_users table it queries — a SQL-language function is validated against
-- existing tables at CREATE FUNCTION time, so it cannot be created before
-- its referenced table exists.

-- Resolves an existing auth.users id by email, so the invite flow can attach
-- an already-registered person to a second organization instead of issuing a
-- duplicate Supabase Auth invite. auth.users is not otherwise reachable via
-- PostgREST; this narrow SECURITY DEFINER function returns only a bare id,
-- callable by any authenticated user, but only ever invoked from the
-- org_admin-gated inviteUser module function. See docs/decisions.md ADR-021.
create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public, anon;
grant execute on function public.find_auth_user_id_by_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Invitation acceptance: an invited (not yet active) user must be able to
-- flip their own membership from 'invited' to 'active' without being an
-- org_admin. Milestone 1's organization_users_update_org_admin policy alone
-- would block this entirely (a non-admin has no matching UPDATE policy). A
-- second, narrow policy lets a self-row transition through RLS; a trigger
-- then locks down exactly which columns may change in that same statement,
-- so a non-admin cannot smuggle a role change (or anything else) into the
-- same UPDATE that accepts their invitation. See docs/decisions.md ADR-024.
-- ---------------------------------------------------------------------------

create policy organization_users_accept_own_invitation
  on public.organization_users
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and status = 'invited'
  )
  with check (
    user_id = (select auth.uid())
  );

create or replace function public.enforce_self_accept_invitation_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_org_admin(new.organization_id) then
    return new;
  end if;

  if new.user_id != auth.uid() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if old.status != 'invited' or new.status != 'active' then
    raise exception 'only accepting an invitation (invited -> active) is permitted'
      using errcode = '42501';
  end if;

  if new.role != old.role
    or new.invited_by_user_id is distinct from old.invited_by_user_id
  then
    raise exception 'only the status column may change when accepting an invitation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger organization_users_enforce_self_accept
  before update on public.organization_users
  for each row
  execute function public.enforce_self_accept_invitation_only();

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------

create type public.team_status as enum ('active', 'inactive');
create type public.assignment_method as enum ('direct', 'round_robin', 'weighted_round_robin');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status public.team_status not null default 'active',
  default_assignment_method public.assignment_method not null default 'round_robin',
  default_acceptance_deadline_minutes int not null default 30 check (default_acceptance_deadline_minutes > 0),
  default_fallback_user_id uuid references auth.users(id) on delete set null,
  timezone text not null default 'UTC',
  operating_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_org_name_unique unique (organization_id, name)
);

comment on table public.teams is
  'Per docs/database-schema.md §2. Created/updated by org_admin only.';

create index teams_organization_id_idx on public.teams (organization_id);

create trigger teams_set_updated_at
  before update on public.teams
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_users
-- ---------------------------------------------------------------------------

create table public.team_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  constraint team_users_team_user_unique unique (team_id, user_id)
);

comment on table public.team_users is
  'Team membership. is_manager = true is what makes a team "permitted" for a '
  'team_manager-role user (docs/decisions.md ADR-007) — see is_permitted_team_manager().';

create index team_users_organization_id_idx on public.team_users (organization_id);
create index team_users_team_id_idx on public.team_users (team_id);
create index team_users_user_id_idx on public.team_users (user_id);
create index team_users_team_manager_idx on public.team_users (team_id, is_manager);

create or replace function public.assert_team_users_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.teams t
    where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'team % does not belong to organization %', new.team_id, new.organization_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = new.organization_id and ou.user_id = new.user_id
  ) then
    raise exception 'user % is not a member of organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger team_users_assert_same_org
  before insert or update on public.team_users
  for each row
  execute function public.assert_team_users_same_org();

-- Defined here (not with the other RLS helpers above) because a
-- SQL-language function is validated against existing tables at CREATE
-- FUNCTION time, and team_users must exist first. SECURITY DEFINER for the
-- same self-referencing-RLS-recursion reason as the other helpers — see
-- docs/decisions.md ADR-023.
create or replace function public.is_permitted_team_manager(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_users tu
    where tu.team_id = p_team_id
      and tu.user_id = auth.uid()
      and tu.is_manager = true
  );
$$;

revoke all on function public.is_permitted_team_manager(uuid) from public, anon;
grant execute on function public.is_permitted_team_manager(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- user_availability
-- ---------------------------------------------------------------------------

create type public.availability_status as enum ('available', 'busy', 'away', 'vacation', 'offline');

create table public.user_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  availability_status public.availability_status not null default 'available',
  status_note text,
  updated_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_availability_org_user_unique unique (organization_id, user_id)
);

comment on table public.user_availability is
  'Per docs/database-schema.md §3. A user updates their own row; org_admin may override.';

create index user_availability_organization_id_idx on public.user_availability (organization_id);
create index user_availability_user_id_idx on public.user_availability (user_id);

create trigger user_availability_set_updated_at
  before update on public.user_availability
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_user_in_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = new.organization_id and ou.user_id = new.user_id
  ) then
    raise exception 'user % is not a member of organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger user_availability_assert_membership
  before insert or update on public.user_availability
  for each row
  execute function public.assert_user_in_organization();

-- ---------------------------------------------------------------------------
-- user_assignment_settings
-- ---------------------------------------------------------------------------

create table public.user_assignment_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  accept_leads boolean not null default true,
  timezone text not null default 'UTC',
  working_hours jsonb not null default '{}'::jsonb,
  daily_lead_limit int not null default 0 check (daily_lead_limit >= 0),
  active_lead_limit int not null default 0 check (active_lead_limit >= 0),
  assignment_weight int not null default 1 check (assignment_weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_assignment_settings_org_user_unique unique (organization_id, user_id)
);

comment on table public.user_assignment_settings is
  'Per docs/database-schema.md §3. accept_leads/timezone/working_hours are '
  'self-editable; daily_lead_limit/active_lead_limit/assignment_weight are '
  'org_admin-configured only, enforced at the server layer (RLS allows the row '
  'update, the module function restricts which columns a non-admin caller may set).';

create index user_assignment_settings_organization_id_idx on public.user_assignment_settings (organization_id);
create index user_assignment_settings_user_id_idx on public.user_assignment_settings (user_id);

create trigger user_assignment_settings_set_updated_at
  before update on public.user_assignment_settings
  for each row
  execute function public.set_updated_at();

create trigger user_assignment_settings_assert_membership
  before insert or update on public.user_assignment_settings
  for each row
  execute function public.assert_user_in_organization();

-- ---------------------------------------------------------------------------
-- recipient_attribute_definitions / recipient_attribute_values
-- ---------------------------------------------------------------------------

create type public.attribute_field_type as enum (
  'text', 'long_text', 'number', 'currency', 'boolean', 'date', 'datetime',
  'single_select', 'multi_select', 'email', 'phone', 'url'
);

create table public.recipient_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  internal_key text not null check (internal_key ~ '^[a-z0-9_]+$'),
  description text,
  field_type public.attribute_field_type not null,
  required boolean not null default false,
  default_value jsonb,
  options jsonb not null default '[]'::jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipient_attribute_definitions_org_key_unique unique (organization_id, internal_key)
);

comment on table public.recipient_attribute_definitions is
  'Per docs/database-schema.md §4 / spec §13. org_admin CUD only.';

create index recipient_attribute_definitions_organization_id_idx
  on public.recipient_attribute_definitions (organization_id);

create trigger recipient_attribute_definitions_set_updated_at
  before update on public.recipient_attribute_definitions
  for each row
  execute function public.set_updated_at();

create table public.recipient_attribute_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attribute_definition_id uuid not null references public.recipient_attribute_definitions(id) on delete cascade,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipient_attribute_values_user_attribute_unique unique (user_id, attribute_definition_id)
);

comment on table public.recipient_attribute_values is
  'Per docs/database-schema.md §4. Set by org_admin only; a user may read their own values.';

create index recipient_attribute_values_organization_id_idx on public.recipient_attribute_values (organization_id);
create index recipient_attribute_values_user_id_idx on public.recipient_attribute_values (user_id);
create index recipient_attribute_values_definition_id_idx on public.recipient_attribute_values (attribute_definition_id);

create trigger recipient_attribute_values_set_updated_at
  before update on public.recipient_attribute_values
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_recipient_attribute_value_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = new.organization_id and ou.user_id = new.user_id
  ) then
    raise exception 'user % is not a member of organization %', new.user_id, new.organization_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.recipient_attribute_definitions d
    where d.id = new.attribute_definition_id and d.organization_id = new.organization_id
  ) then
    raise exception 'attribute definition % does not belong to organization %',
      new.attribute_definition_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger recipient_attribute_values_assert_same_org
  before insert or update on public.recipient_attribute_values
  for each row
  execute function public.assert_recipient_attribute_value_same_org();

-- ---------------------------------------------------------------------------
-- import_jobs / import_rows (bulk CSV user import)
-- ---------------------------------------------------------------------------

create type public.import_type as enum ('users', 'territories');
create type public.import_status as enum ('pending', 'validating', 'ready', 'importing', 'completed', 'failed');
create type public.import_row_status as enum ('valid', 'invalid', 'imported', 'skipped');

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_type public.import_type not null,
  status public.import_status not null default 'pending',
  file_reference text,
  column_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  allow_partial boolean not null default false,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.import_jobs is
  'Per docs/database-schema.md §14 / spec §14. org_admin only.';

create index import_jobs_organization_id_idx on public.import_jobs (organization_id);

create trigger import_jobs_set_updated_at
  before update on public.import_jobs
  for each row
  execute function public.set_updated_at();

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_number int not null,
  raw_data jsonb not null,
  status public.import_row_status not null default 'invalid',
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint import_rows_job_row_unique unique (import_job_id, row_number)
);

comment on table public.import_rows is
  'Per docs/database-schema.md §14. One row per source CSV row for preview/validation/error display.';

create index import_rows_organization_id_idx on public.import_rows (organization_id);
create index import_rows_import_job_id_idx on public.import_rows (import_job_id);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null check (char_length(action) between 1 and 200),
  entity_type text not null check (char_length(entity_type) between 1 and 200),
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Per docs/database-schema.md §17 / docs/security-model.md §8. Insert-only — no '
  'application role ever receives UPDATE/DELETE grants on this table.';

create index audit_logs_organization_id_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.teams enable row level security;
alter table public.team_users enable row level security;
alter table public.user_availability enable row level security;
alter table public.user_assignment_settings enable row level security;
alter table public.recipient_attribute_definitions enable row level security;
alter table public.recipient_attribute_values enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
alter table public.audit_logs enable row level security;

-- teams: any active org member may read (agents need to know their own team's
-- name); only org_admin may create/update/delete.
create policy teams_select_active_member
  on public.teams
  for select
  to authenticated
  using (public.is_active_org_member(organization_id));

create policy teams_insert_org_admin
  on public.teams
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy teams_update_org_admin
  on public.teams
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy teams_delete_org_admin
  on public.teams
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- team_users: org_admin sees/manages all; a team_manager sees rosters only for
-- teams they manage (is_manager = true); an agent sees only their own row.
create policy team_users_select_scoped
  on public.team_users
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or public.is_permitted_team_manager(team_id)
    or user_id = (select auth.uid())
  );

create policy team_users_insert_org_admin
  on public.team_users
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy team_users_update_org_admin
  on public.team_users
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy team_users_delete_org_admin
  on public.team_users
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- user_availability: self, org_admin (any user in org), or a team_manager
-- permitted for one of that user's teams may read; only self or org_admin may
-- write (server layer further restricts which columns a non-admin may set).
create policy user_availability_select_scoped
  on public.user_availability
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.team_users tu
      where tu.user_id = user_availability.user_id
        and public.is_permitted_team_manager(tu.team_id)
    )
  );

create policy user_availability_insert_self_or_admin
  on public.user_availability
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  );

create policy user_availability_update_self_or_admin
  on public.user_availability
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  )
  with check (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  );

-- user_assignment_settings: same read scope as availability; write restricted
-- to self or org_admin (capacity/weight columns are admin-only at the server
-- layer, per the table comment above).
create policy user_assignment_settings_select_scoped
  on public.user_assignment_settings
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.team_users tu
      where tu.user_id = user_assignment_settings.user_id
        and public.is_permitted_team_manager(tu.team_id)
    )
  );

create policy user_assignment_settings_insert_self_or_admin
  on public.user_assignment_settings
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  );

create policy user_assignment_settings_update_self_or_admin
  on public.user_assignment_settings
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  )
  with check (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
  );

-- recipient_attribute_definitions: any active member reads; org_admin CUD.
create policy recipient_attribute_definitions_select_active_member
  on public.recipient_attribute_definitions
  for select
  to authenticated
  using (public.is_active_org_member(organization_id));

create policy recipient_attribute_definitions_insert_org_admin
  on public.recipient_attribute_definitions
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy recipient_attribute_definitions_update_org_admin
  on public.recipient_attribute_definitions
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy recipient_attribute_definitions_delete_org_admin
  on public.recipient_attribute_definitions
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- recipient_attribute_values: self/org_admin/permitted team_manager read;
-- org_admin CUD only (spec: administrators configure recipient attributes).
create policy recipient_attribute_values_select_scoped
  on public.recipient_attribute_values
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_admin(organization_id)
    or exists (
      select 1 from public.team_users tu
      where tu.user_id = recipient_attribute_values.user_id
        and public.is_permitted_team_manager(tu.team_id)
    )
  );

create policy recipient_attribute_values_insert_org_admin
  on public.recipient_attribute_values
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy recipient_attribute_values_update_org_admin
  on public.recipient_attribute_values
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy recipient_attribute_values_delete_org_admin
  on public.recipient_attribute_values
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- import_jobs / import_rows: org_admin only, full stop.
create policy import_jobs_all_org_admin
  on public.import_jobs
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy import_rows_all_org_admin
  on public.import_rows
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- audit_logs: any active member may insert an audit row for their own action
-- (module functions run as the acting user, never service-role, so the actor
-- is always the real caller); only org_admin may read. No UPDATE/DELETE
-- policy exists for any role — the table is insert/select only.
create policy audit_logs_insert_self_action
  on public.audit_logs
  for insert
  to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and public.is_active_org_member(organization_id)
  );

create policy audit_logs_select_org_admin
  on public.audit_logs
  for select
  to authenticated
  using (public.is_org_admin(organization_id));
