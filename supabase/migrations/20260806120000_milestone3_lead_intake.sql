-- Milestone 3: Lead intake — sources, field mapping, custom variables,
-- leads, duplicate detection, submission logs, API tokens. See
-- docs/database-schema.md §6-7/§14/§18, docs/security-model.md §4,
-- docs/permissions-matrix.md, docs/decisions.md ADR-004/ADR-005/ADR-011.
--
-- Routing/assignment and internal location processing (lead_locations_internal,
-- territories) are explicitly out of scope for this milestone — see
-- docs/implementation-plan.md Milestone 3/4 boundary.

-- ---------------------------------------------------------------------------
-- pgcrypto (for source-token hashing inside SECURITY DEFINER functions).
-- Standard Supabase extension, not a new database provider — see
-- docs/decisions.md ADR-002 (same rationale as PostGIS).
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.lead_source_type as enum ('api', 'webhook', 'external_form', 'manual', 'csv', 'crm');
create type public.lead_source_status as enum ('active', 'inactive');

create type public.field_mapping_destination_type as enum ('default_field', 'custom_variable', 'ignored');
create type public.field_mapping_transformation as enum (
  'trim', 'lowercase', 'uppercase', 'normalize_email', 'normalize_phone',
  'parse_number', 'parse_currency', 'to_boolean', 'split_full_name',
  'join_values', 'replace_values', 'apply_default'
);

create type public.submission_log_status as enum ('received', 'validated', 'failed', 'resubmitted', 'ignored');

create type public.lead_duplicate_match_basis as enum (
  'idempotency_key', 'external_submission_id', 'email', 'phone', 'external_crm_record_id'
);
create type public.lead_duplicate_action as enum (
  'flag_and_continue', 'send_to_manual_review', 'update_existing', 'reject_submission'
);
create type public.lead_duplicate_status as enum ('unique', 'possible_duplicate', 'duplicate');

-- ---------------------------------------------------------------------------
-- lead_sources
-- ---------------------------------------------------------------------------

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  source_type public.lead_source_type not null,
  status public.lead_source_status not null default 'active',
  source_token_hash text not null,
  default_routing_flow_id uuid,
  rate_limit_settings jsonb not null default '{"windowSeconds": 60, "maxRequests": 120}'::jsonb,
  signature_settings jsonb not null default '{"enabled": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_sources_source_token_hash_unique unique (source_token_hash)
);

comment on table public.lead_sources is
  'Per docs/database-schema.md §6 / spec §17. org_admin CUD only. '
  'source_token_hash is a sha256 hex digest — the plaintext token is shown '
  'once at creation/rotation and never persisted (docs/security-model.md §3). '
  'default_routing_flow_id has no FK yet — routing_flows does not exist until '
  'Milestone 5.';

create index lead_sources_organization_id_idx on public.lead_sources (organization_id);

create trigger lead_sources_set_updated_at
  before update on public.lead_sources
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- api_tokens (issuance/rotation audit trail backing lead_sources.source_token_hash)
-- ---------------------------------------------------------------------------

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_source_id uuid not null references public.lead_sources(id) on delete cascade,
  token_hash text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint api_tokens_token_hash_unique unique (token_hash)
);

comment on table public.api_tokens is
  'Per docs/database-schema.md §18. One row per issued/rotated token for a '
  'lead source; only the currently-active row''s hash matches lead_sources.source_token_hash.';

create index api_tokens_organization_id_idx on public.api_tokens (organization_id);
create index api_tokens_lead_source_id_idx on public.api_tokens (lead_source_id);

-- ---------------------------------------------------------------------------
-- intake_rate_limit_counters (per spec §18/§52, docs/decisions.md ADR-004:
-- database-backed, not Redis-backed). No RLS policies are defined for this
-- table (default deny to every application role) — it is written and read
-- exclusively through the SECURITY DEFINER function below, since the public
-- intake route has no session and no membership to check RLS against.
-- ---------------------------------------------------------------------------

create table public.intake_rate_limit_counters (
  id uuid primary key default gen_random_uuid(),
  lead_source_id uuid not null references public.lead_sources(id) on delete cascade,
  time_bucket timestamptz not null,
  request_count int not null default 0,
  constraint intake_rate_limit_counters_source_bucket_unique unique (lead_source_id, time_bucket)
);

create index intake_rate_limit_counters_lead_source_id_idx
  on public.intake_rate_limit_counters (lead_source_id);

-- ---------------------------------------------------------------------------
-- field_mappings
-- ---------------------------------------------------------------------------

create table public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_source_id uuid not null references public.lead_sources(id) on delete cascade,
  source_field_name text not null check (char_length(source_field_name) between 1 and 200),
  destination_type public.field_mapping_destination_type not null,
  destination_field text,
  data_type text not null,
  required boolean not null default false,
  default_value jsonb,
  transformation public.field_mapping_transformation,
  validation_rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_mappings_source_field_unique unique (lead_source_id, source_field_name)
);

comment on table public.field_mappings is
  'Per docs/database-schema.md §6 / spec §19. org_admin CUD only.';

create index field_mappings_organization_id_idx on public.field_mappings (organization_id);
create index field_mappings_lead_source_id_idx on public.field_mappings (lead_source_id);

create trigger field_mappings_set_updated_at
  before update on public.field_mappings
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- custom_variable_definitions (leads' analogue of recipient_attribute_definitions)
-- ---------------------------------------------------------------------------

create table public.custom_variable_definitions (
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
  constraint custom_variable_definitions_org_key_unique unique (organization_id, internal_key)
);

comment on table public.custom_variable_definitions is
  'Per docs/database-schema.md §6 / spec §16. org_admin CUD; any active member reads '
  '(agents/managers need definitions to render a lead''s custom values).';

create index custom_variable_definitions_organization_id_idx
  on public.custom_variable_definitions (organization_id);

create trigger custom_variable_definitions_set_updated_at
  before update on public.custom_variable_definitions
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Identity
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,

  -- Basic location (spec §15.2). Internal coordinates/geography are never
  -- stored here — see docs/database-schema.md §7 (lead_locations_internal,
  -- Milestone 4) and CLAUDE.md rule 3.
  street_address text,
  unit_number text,
  neighborhood text,
  city text,
  county text,
  state_province text,
  postal_code text,
  country text,

  -- Source information
  lead_source_id uuid references public.lead_sources(id) on delete set null,
  external_submission_id text,
  message text,
  campaign text,
  medium text,
  referrer text,
  landing_page text,

  -- Consent
  email_consent boolean not null default false,
  sms_consent boolean not null default false,
  privacy_consent boolean not null default false,
  consent_text text,
  consent_timestamp timestamptz,
  consent_ip inet,

  -- System
  assigned_team_id uuid references public.teams(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  -- lead_status is free text (not an enum/FK) until Milestone 7 introduces
  -- org-configurable lead_status_definitions (spec §37) — see docs/decisions.md.
  lead_status text not null default 'new',
  -- assignment_status is constrained to 'unassigned' in this milestone since
  -- no routing/assignment exists yet; Milestone 5/6 will extend this
  -- constraint when live assignment states are introduced.
  assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned')),
  priority int not null default 0,
  duplicate_status public.lead_duplicate_status not null default 'unique',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_source_external_submission_unique
    unique (lead_source_id, external_submission_id)
);

comment on table public.leads is
  'Per docs/database-schema.md §7 / spec §15. Default fields only — no '
  'latitude/longitude/location_confidence/product_type/etc. columns here.';

create index leads_organization_id_idx on public.leads (organization_id);
create index leads_organization_assigned_user_idx on public.leads (organization_id, assigned_user_id);
create index leads_organization_assigned_team_idx on public.leads (organization_id, assigned_team_id);
create index leads_lead_source_id_idx on public.leads (lead_source_id);

create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_custom_values
-- ---------------------------------------------------------------------------

create table public.lead_custom_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  variable_definition_id uuid not null references public.custom_variable_definitions(id) on delete cascade,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_custom_values_lead_variable_unique unique (lead_id, variable_definition_id)
);

comment on table public.lead_custom_values is
  'Per docs/database-schema.md §7. Same visibility as the parent lead.';

create index lead_custom_values_organization_id_idx on public.lead_custom_values (organization_id);
create index lead_custom_values_lead_id_idx on public.lead_custom_values (lead_id);

create trigger lead_custom_values_set_updated_at
  before update on public.lead_custom_values
  for each row
  execute function public.set_updated_at();

create or replace function public.assert_lead_custom_value_same_org()
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

  if not exists (
    select 1 from public.custom_variable_definitions d
    where d.id = new.variable_definition_id and d.organization_id = new.organization_id
  ) then
    raise exception 'variable definition % does not belong to organization %',
      new.variable_definition_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger lead_custom_values_assert_same_org
  before insert or update on public.lead_custom_values
  for each row
  execute function public.assert_lead_custom_value_same_org();

-- ---------------------------------------------------------------------------
-- lead_duplicates
-- ---------------------------------------------------------------------------

create table public.lead_duplicates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  duplicate_of_lead_id uuid not null references public.leads(id) on delete cascade,
  match_basis public.lead_duplicate_match_basis not null,
  action_taken public.lead_duplicate_action not null,
  created_at timestamptz not null default now()
);

comment on table public.lead_duplicates is
  'Per docs/database-schema.md §7 / spec §21. Every duplicate decision is recorded here.';

create index lead_duplicates_organization_id_idx on public.lead_duplicates (organization_id);
create index lead_duplicates_lead_id_idx on public.lead_duplicates (lead_id);

-- ---------------------------------------------------------------------------
-- submission_logs
-- ---------------------------------------------------------------------------

create table public.submission_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_source_id uuid not null references public.lead_sources(id) on delete cascade,
  raw_payload jsonb not null,
  mapped_payload jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  status public.submission_log_status not null default 'received',
  idempotency_key text,
  external_submission_id text,
  test_mode boolean not null default false,
  resulting_lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_logs_source_idempotency_key_unique
    unique (lead_source_id, idempotency_key)
);

comment on table public.submission_logs is
  'Per docs/database-schema.md §14 / spec §20. raw_payload/mapped_payload may '
  'contain personal data — org_admin only, never sent to Sentry or application '
  'logs (docs/security-model.md, CLAUDE.md rule 18).';

create index submission_logs_organization_id_idx on public.submission_logs (organization_id, created_at desc);
create index submission_logs_lead_source_id_idx on public.submission_logs (lead_source_id);

create trigger submission_logs_set_updated_at
  before update on public.submission_logs
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.lead_sources enable row level security;
alter table public.api_tokens enable row level security;
alter table public.intake_rate_limit_counters enable row level security;
alter table public.field_mappings enable row level security;
alter table public.custom_variable_definitions enable row level security;
alter table public.leads enable row level security;
alter table public.lead_custom_values enable row level security;
alter table public.lead_duplicates enable row level security;
alter table public.submission_logs enable row level security;

-- lead_sources / api_tokens / field_mappings: org_admin only, full stop
-- (docs/permissions-matrix.md "Create/update lead sources & tokens" and
-- "Configure field mappings" — no non-admin capability exists for these at all).
create policy lead_sources_all_org_admin
  on public.lead_sources
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy api_tokens_all_org_admin
  on public.api_tokens
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy field_mappings_all_org_admin
  on public.field_mappings
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- intake_rate_limit_counters: no policies for any role — accessed exclusively
-- through the SECURITY DEFINER function below, which runs as the table owner
-- and therefore bypasses RLS entirely. This is intentional: the public intake
-- route has no session at all, so "to authenticated" policies would not help.

-- custom_variable_definitions: any active member reads; org_admin CUD.
create policy custom_variable_definitions_select_active_member
  on public.custom_variable_definitions
  for select
  to authenticated
  using (public.is_active_org_member(organization_id));

create policy custom_variable_definitions_insert_org_admin
  on public.custom_variable_definitions
  for insert
  to authenticated
  with check (public.is_org_admin(organization_id));

create policy custom_variable_definitions_update_org_admin
  on public.custom_variable_definitions
  for update
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy custom_variable_definitions_delete_org_admin
  on public.custom_variable_definitions
  for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- leads: org_admin sees/manages all; a team_manager sees/manages leads
-- assigned to a team they are permitted for; an agent sees/updates-status-on
-- only leads assigned to them. No routing exists yet in this milestone, so
-- assigned_team_id/assigned_user_id will typically be null and only
-- org_admin will see rows in practice — this policy is written to already
-- match docs/permissions-matrix.md's "Leads" section ahead of Milestone 5/6.
create policy leads_select_scoped
  on public.leads
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or (assigned_team_id is not null and public.is_permitted_team_manager(assigned_team_id))
    or assigned_user_id = (select auth.uid())
  );

-- Manual lead entry (modules/leads) is org_admin/team_manager only, mirroring
-- "Manually assign / reassign a lead" in the permissions matrix — an agent
-- cannot create leads directly.
create policy leads_insert_admin_or_team_manager
  on public.leads
  for insert
  to authenticated
  with check (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.team_users tu
      where tu.organization_id = leads.organization_id
        and tu.user_id = (select auth.uid())
        and tu.is_manager = true
    )
  );

create policy leads_update_scoped
  on public.leads
  for update
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or (assigned_team_id is not null and public.is_permitted_team_manager(assigned_team_id))
    or assigned_user_id = (select auth.uid())
  )
  with check (
    public.is_org_admin(organization_id)
    or (assigned_team_id is not null and public.is_permitted_team_manager(assigned_team_id))
    or assigned_user_id = (select auth.uid())
  );

-- lead_custom_values: same scope as the parent lead for select; org_admin or
-- a permitted team_manager may write (mirrors leads_update_scoped minus the
-- agent-self case, since custom values are configured, not self-service).
create policy lead_custom_values_select_scoped
  on public.lead_custom_values
  for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = lead_custom_values.lead_id
        and (
          (l.assigned_team_id is not null and public.is_permitted_team_manager(l.assigned_team_id))
          or l.assigned_user_id = (select auth.uid())
        )
    )
  );

create policy lead_custom_values_insert_admin_or_team_manager
  on public.lead_custom_values
  for insert
  to authenticated
  with check (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = lead_custom_values.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  );

create policy lead_custom_values_update_admin_or_team_manager
  on public.lead_custom_values
  for update
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = lead_custom_values.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  )
  with check (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.leads l
      where l.id = lead_custom_values.lead_id
        and l.assigned_team_id is not null
        and public.is_permitted_team_manager(l.assigned_team_id)
    )
  );

-- lead_duplicates: org_admin only (diagnostic/administrative record).
create policy lead_duplicates_all_org_admin
  on public.lead_duplicates
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- submission_logs: org_admin only, per permissions-matrix.md "View submission logs".
create policy submission_logs_all_org_admin
  on public.submission_logs
  for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- resolve_lead_source: the intake route's one pre-auth database access point
-- (docs/decisions.md ADR-011). Callable by the anon role — no session exists
-- yet at this point in the request. Takes an already-sha256-hashed token
-- (hashed application-side, matching lead_sources.source_token_hash's
-- format) rather than hashing internally, so the plaintext token never has
-- to cross into a second hashing implementation to stay consistent; the one
-- exception is record_lead_submission below, which independently
-- re-validates the source id and status rather than trusting the caller,
-- since this function runs as SECURITY DEFINER and is reachable by anon.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_lead_source(p_token_hash text)
returns table (
  lead_source_id uuid,
  organization_id uuid,
  status public.lead_source_status,
  rate_limit_settings jsonb,
  signature_settings jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select ls.id, ls.organization_id, ls.status, ls.rate_limit_settings, ls.signature_settings
  from public.lead_sources ls
  where ls.source_token_hash = p_token_hash
  limit 1;
$$;

revoke all on function public.resolve_lead_source(text) from public;
grant execute on function public.resolve_lead_source(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- check_and_increment_intake_rate_limit: atomic upsert-based counter, per
-- docs/decisions.md ADR-004. Fixed time buckets (not a sliding window) —
-- acceptable per-source approximation for Milestone 3; documented as a
-- known simplification.
-- ---------------------------------------------------------------------------

create or replace function public.check_and_increment_intake_rate_limit(
  p_lead_source_id uuid,
  p_window_seconds int,
  p_max_requests int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_count int;
begin
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.intake_rate_limit_counters (lead_source_id, time_bucket, request_count)
  values (p_lead_source_id, v_bucket, 1)
  on conflict (lead_source_id, time_bucket)
  do update set request_count = public.intake_rate_limit_counters.request_count + 1
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.check_and_increment_intake_rate_limit(uuid, int, int) from public;
grant execute on function public.check_and_increment_intake_rate_limit(uuid, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_lead_submission: the single transactional write path for intake —
-- inserts submission_logs and, unless test_mode or the row was rejected,
-- leads/lead_custom_values/lead_duplicates, all atomically. Mapping,
-- validation, and duplicate-decision logic live in modules/field-mapping,
-- modules/duplicate-detection (TypeScript, unit-testable); this function
-- performs only the already-decided, privileged multi-table write, callable
-- by anon since the intake route has no session. Idempotent: a repeat call
-- with the same (lead_source_id, idempotency_key) returns the original
-- result instead of creating a second submission/lead (spec §21, CLAUDE.md
-- rule 20).
-- ---------------------------------------------------------------------------

create or replace function public.record_lead_submission(
  p_lead_source_id uuid,
  p_idempotency_key text,
  p_external_submission_id text,
  p_raw_payload jsonb,
  p_mapped_payload jsonb,
  p_validation_errors jsonb,
  p_submission_status text,
  p_test_mode boolean,
  p_lead_fields jsonb,
  p_lead_duplicate_status text,
  p_custom_values jsonb,
  p_duplicate_of_lead_id uuid,
  p_match_basis text,
  p_duplicate_action text
)
returns table (submission_log_id uuid, lead_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status public.lead_source_status;
  v_log_id uuid;
  v_lead_id uuid;
  v_existing_log_id uuid;
  v_existing_lead_id uuid;
begin
  select ls.organization_id, ls.status into v_org_id, v_status
  from public.lead_sources ls
  where ls.id = p_lead_source_id;

  if v_org_id is null then
    raise exception 'unknown lead source' using errcode = '28000';
  end if;

  if v_status <> 'active' then
    raise exception 'lead source is not active' using errcode = '28000';
  end if;

  if p_idempotency_key is not null then
    select sl.id, sl.resulting_lead_id into v_existing_log_id, v_existing_lead_id
    from public.submission_logs sl
    where sl.lead_source_id = p_lead_source_id
      and sl.idempotency_key = p_idempotency_key;

    if v_existing_log_id is not null then
      return query select v_existing_log_id, v_existing_lead_id;
      return;
    end if;
  end if;

  insert into public.submission_logs (
    organization_id, lead_source_id, raw_payload, mapped_payload,
    validation_errors, status, idempotency_key, external_submission_id, test_mode
  ) values (
    v_org_id, p_lead_source_id, p_raw_payload, coalesce(p_mapped_payload, '{}'::jsonb),
    coalesce(p_validation_errors, '[]'::jsonb), p_submission_status::public.submission_log_status,
    p_idempotency_key, p_external_submission_id, p_test_mode
  )
  returning id into v_log_id;

  if p_test_mode or p_lead_fields is null then
    return query select v_log_id, null::uuid;
    return;
  end if;

  insert into public.leads (
    organization_id, first_name, last_name, full_name, email, phone,
    street_address, unit_number, neighborhood, city, county, state_province,
    postal_code, country, lead_source_id, external_submission_id, message,
    campaign, medium, referrer, landing_page,
    email_consent, sms_consent, privacy_consent, consent_text, consent_timestamp, consent_ip,
    duplicate_status
  ) values (
    v_org_id,
    p_lead_fields->>'first_name', p_lead_fields->>'last_name', p_lead_fields->>'full_name',
    p_lead_fields->>'email', p_lead_fields->>'phone',
    p_lead_fields->>'street_address', p_lead_fields->>'unit_number', p_lead_fields->>'neighborhood',
    p_lead_fields->>'city', p_lead_fields->>'county', p_lead_fields->>'state_province',
    p_lead_fields->>'postal_code', p_lead_fields->>'country',
    p_lead_source_id, p_external_submission_id, p_lead_fields->>'message',
    p_lead_fields->>'campaign', p_lead_fields->>'medium', p_lead_fields->>'referrer',
    p_lead_fields->>'landing_page',
    coalesce((p_lead_fields->>'email_consent')::boolean, false),
    coalesce((p_lead_fields->>'sms_consent')::boolean, false),
    coalesce((p_lead_fields->>'privacy_consent')::boolean, false),
    p_lead_fields->>'consent_text',
    nullif(p_lead_fields->>'consent_timestamp', '')::timestamptz,
    nullif(p_lead_fields->>'consent_ip', '')::inet,
    coalesce(p_lead_duplicate_status, 'unique')::public.lead_duplicate_status
  )
  returning id into v_lead_id;

  if p_custom_values is not null then
    insert into public.lead_custom_values (organization_id, lead_id, variable_definition_id, value)
    select v_org_id, v_lead_id, (elem->>'variable_definition_id')::uuid, elem->'value'
    from jsonb_array_elements(p_custom_values) as elem;
  end if;

  if p_duplicate_of_lead_id is not null then
    insert into public.lead_duplicates (organization_id, lead_id, duplicate_of_lead_id, match_basis, action_taken)
    values (
      v_org_id, v_lead_id, p_duplicate_of_lead_id,
      p_match_basis::public.lead_duplicate_match_basis,
      p_duplicate_action::public.lead_duplicate_action
    );
  end if;

  update public.submission_logs set resulting_lead_id = v_lead_id, updated_at = now() where id = v_log_id;

  return query select v_log_id, v_lead_id;
end;
$$;

revoke all on function public.record_lead_submission(
  uuid, text, text, jsonb, jsonb, jsonb, text, boolean, jsonb, text, jsonb, uuid, text, text
) from public;
grant execute on function public.record_lead_submission(
  uuid, text, text, jsonb, jsonb, jsonb, text, boolean, jsonb, text, jsonb, uuid, text, text
) to anon, authenticated;
