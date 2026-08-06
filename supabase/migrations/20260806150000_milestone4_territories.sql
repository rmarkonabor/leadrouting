-- Milestone 4: Territories and internal location processing. See
-- docs/database-schema.md §5/§7, docs/phase1-product-spec.md §22-24,
-- docs/decisions.md ADR-002 (PostGIS), ADR-027 (sequencing).
--
-- Routing rules are explicitly out of scope for this milestone
-- (docs/implementation-plan.md Milestone 4/5 boundary).

-- ---------------------------------------------------------------------------
-- PostGIS: attempted best-effort, never allowed to abort this migration.
-- Radius territories are only permitted at the application layer when
-- public.is_postgis_available() reports true (checked live, not assumed) —
-- see docs/decisions.md for this milestone's PostGIS-availability ADR. The
-- other six territory types (country/state_province/county/city/
-- neighborhood/postal_code) work identically with or without PostGIS.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists postgis with schema extensions;
exception when others then
  raise notice 'PostGIS extension could not be enabled: %', sqlerrm;
end;
$$;

create or replace function public.is_postgis_available()
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_extension where extname = 'postgis');
$$;

comment on function public.is_postgis_available() is
  'Live capability check, not an assumption — gates radius territory '
  'creation/matching at the application layer per spec §23.';

grant execute on function public.is_postgis_available() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- territories
-- ---------------------------------------------------------------------------

create type public.territory_type as enum (
  'country', 'state_province', 'county', 'city', 'neighborhood', 'postal_code', 'radius'
);
create type public.territory_status as enum ('active', 'inactive');

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  territory_type public.territory_type not null,
  country text,
  state_province text,
  county text,
  city text,
  neighborhood text,
  postal_code text,
  -- center_geography/radius_distance are populated only for territory_type =
  -- 'radius'. The column type itself requires PostGIS's `geography` type to
  -- exist; on the very rare deployment where the extension truly could not
  -- be enabled above, this column definition would fail and this migration
  -- would need to be re-run once PostGIS is available — Supabase ships
  -- PostGIS as a standard bundled extension, so this is not expected in
  -- practice. The *application-level* gate (is_postgis_available()) is what
  -- actually enforces "only when PostGIS is correctly available" per spec §23.
  center_geography extensions.geography(Point, 4326),
  -- Plain numeric mirrors of center_geography's coordinates, kept in sync by
  -- the trigger below. PostgREST returns `geography` columns as WKB hex by
  -- default, which the application's pure-JS matching/conflict-detection
  -- functions (modules/territories/match-territories.ts) would have to
  -- parse for no real benefit — reading two plain numbers is simpler and
  -- keeps that matching logic decoupled from a live PostGIS query. The
  -- actual database-backed radius query still uses `center_geography` with
  -- `ST_DWithin`, so this is a read-convenience duplicate, not a second
  -- source of truth.
  center_latitude double precision,
  center_longitude double precision,
  radius_distance numeric check (radius_distance is null or radius_distance > 0),
  priority int not null default 100,
  status public.territory_status not null default 'active',
  effective_start_date date,
  effective_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint territories_type_field_present check (
    (territory_type = 'country' and country is not null)
    or (territory_type = 'state_province' and state_province is not null)
    or (territory_type = 'county' and county is not null)
    or (territory_type = 'city' and city is not null)
    or (territory_type = 'neighborhood' and neighborhood is not null)
    or (territory_type = 'postal_code' and postal_code is not null)
    or (
      territory_type = 'radius'
      and center_geography is not null
      and center_latitude is not null
      and center_longitude is not null
      and radius_distance is not null
    )
  ),
  constraint territories_radius_fields_only_for_radius check (
    territory_type = 'radius'
    or (center_geography is null and center_latitude is null and center_longitude is null and radius_distance is null)
  ),
  constraint territories_effective_dates_order check (
    effective_start_date is null or effective_end_date is null or effective_start_date <= effective_end_date
  )
);

comment on table public.territories is
  'Per docs/database-schema.md §5 / spec §23. org_admin CUD only; any active '
  'org member may read (mirrors teams). Never joined into any customer-'
  'editable lead field response — see lead_locations_internal below.';

create index territories_organization_id_idx on public.territories (organization_id);
create index territories_organization_type_idx on public.territories (organization_id, territory_type);
create index territories_organization_postal_code_idx
  on public.territories (organization_id, postal_code)
  where postal_code is not null;
create index territories_center_geography_gist_idx
  on public.territories using gist (center_geography)
  where center_geography is not null;

create trigger territories_set_updated_at
  before update on public.territories
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- territory_users / territory_teams
-- ---------------------------------------------------------------------------

create table public.territory_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint territory_users_territory_user_unique unique (territory_id, user_id)
);

comment on table public.territory_users is
  'Per docs/database-schema.md §5. A territory may belong to a user, a team, or both.';

create index territory_users_organization_id_idx on public.territory_users (organization_id);
create index territory_users_territory_id_idx on public.territory_users (territory_id);
create index territory_users_user_id_idx on public.territory_users (user_id);

create table public.territory_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint territory_teams_territory_team_unique unique (territory_id, team_id)
);

comment on table public.territory_teams is
  'Per docs/database-schema.md §5.';

create index territory_teams_organization_id_idx on public.territory_teams (organization_id);
create index territory_teams_territory_id_idx on public.territory_teams (territory_id);
create index territory_teams_team_id_idx on public.territory_teams (team_id);

create or replace function public.assert_territory_membership_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.territories t
    where t.id = new.territory_id and t.organization_id = new.organization_id
  ) then
    raise exception 'territory % does not belong to organization %', new.territory_id, new.organization_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger territory_users_assert_same_org
  before insert or update on public.territory_users
  for each row
  execute function public.assert_territory_membership_same_org();

create trigger territory_teams_assert_same_org
  before insert or update on public.territory_teams
  for each row
  execute function public.assert_territory_membership_same_org();

-- ---------------------------------------------------------------------------
-- lead_locations_internal (spec §22). Never exposed as an editable lead
-- field — the original submitted location lives untouched on `leads`
-- (street_address/city/state_province/postal_code/country, from Milestone
-- 3); this table holds only derived, internal-only data used for territory
-- and radius matching, address normalization, ambiguity detection, and
-- routing diagnostics.
-- ---------------------------------------------------------------------------

create type public.location_normalization_status as enum (
  'confirmed', 'partial', 'ambiguous', 'invalid', 'not_provided'
);

create table public.lead_locations_internal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  normalized_address text,
  internal_latitude double precision,
  internal_longitude double precision,
  internal_geography extensions.geography(Point, 4326),
  geographic_identifier text,
  normalization_status public.location_normalization_status not null default 'not_provided',
  normalization_provider text,
  normalization_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_locations_internal_lead_unique unique (lead_id)
);

comment on table public.lead_locations_internal is
  'Per docs/database-schema.md §7 / spec §22. Internal-only — never returned '
  'by any lead-facing API/UI field. org_admin only, matching submission_logs '
  '(docs/security-model.md).';

create index lead_locations_internal_organization_id_idx on public.lead_locations_internal (organization_id);
create index lead_locations_internal_lead_id_idx on public.lead_locations_internal (lead_id);
create index lead_locations_internal_geography_gist_idx
  on public.lead_locations_internal using gist (internal_geography)
  where internal_geography is not null;

create trigger lead_locations_internal_set_updated_at
  before update on public.lead_locations_internal
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_lead_location_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.leads l
    where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'lead % does not belong to organization %', new.lead_id, new.organization_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lead_locations_internal_assert_same_org
  before insert or update on public.lead_locations_internal
  for each row
  execute function public.assert_lead_location_same_org();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.territories enable row level security;
alter table public.territory_users enable row level security;
alter table public.territory_teams enable row level security;
alter table public.lead_locations_internal enable row level security;

-- territories: any active member reads (mirrors teams); org_admin CUD only.
create policy territories_select_active_member
  on public.territories
  for select
  to authenticated
  using (public.is_active_org_member(organization_id));

create policy territories_insert_org_admin
  on public.territories
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy territories_update_org_admin
  on public.territories
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy territories_delete_org_admin
  on public.territories
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- territory_users: org_admin sees/manages all; a user sees their own rows.
create policy territory_users_select_scoped
  on public.territory_users
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or user_id = (select auth.uid())
  );

create policy territory_users_insert_org_admin
  on public.territory_users
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy territory_users_update_org_admin
  on public.territory_users
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy territory_users_delete_org_admin
  on public.territory_users
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- territory_teams: org_admin sees/manages all; any member of the linked team
-- may see the row (informational: "which territories is my team responsible for").
create policy territory_teams_select_scoped
  on public.territory_teams
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.team_users tu
      where tu.team_id = territory_teams.team_id
        and tu.user_id = (select auth.uid())
    )
  );

create policy territory_teams_insert_org_admin
  on public.territory_teams
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy territory_teams_update_org_admin
  on public.territory_teams
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy territory_teams_delete_org_admin
  on public.territory_teams
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- lead_locations_internal: org_admin only, full stop — never exposed to any
-- other role, matching the "must not appear as customer editable default
-- lead fields" requirement at the data-access layer, not just the UI layer.
create policy lead_locations_internal_all_org_admin
  on public.lead_locations_internal
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- import_jobs.import_type already includes 'territories' (Milestone 2
-- migration) — bulk postal code / territory import (requirement 12) reuses
-- those tables directly; no schema change needed here.
-- ---------------------------------------------------------------------------
