-- Milestone 8: Integrations. See docs/database-schema.md §15/§16,
-- docs/background-processing.md, docs/phase1-product-spec.md §42-44.
--
-- Scope per the kickoff: generic outbound webhooks + one CRM adapter only.
-- No calls/SMS/email-conversation/appointment/historical-activity sync
-- (explicitly excluded by spec §42). The routing platform remains the
-- source of truth for routing/acceptance/assignment history — this
-- migration only ever reads those tables to build outgoing payloads, never
-- writes to leads/assignments/activities from the CRM or webhook side
-- (inbound CRM status changes go through update_lead_status, the same
-- function the UI uses, not a private write path).
--
-- See docs/decisions.md ADR-051 through ADR-055 for the architecture
-- rationale: why lifecycle events fire via AFTER triggers rather than
-- editing the M3/M5/M6/M7 core transactional functions (the hard
-- "never risk routing concurrency" rule), why credential/secret encryption
-- is application-level AES-256-GCM rather than Supabase Vault (resolving
-- ADR-003), why retries drain from the existing `integration_jobs` ledger
-- rather than a third literal pgmq queue, and why the one CRM adapter is a
-- generic, settings-configured HTTP adapter rather than a named vendor's
-- undocumented-to-us API.

-- ---------------------------------------------------------------------------
-- Generic integration_job queue functions, parameterized by queue_name.
-- integration_jobs (created in Milestone 6) was already designed to back
-- these two new queues (see that migration's own comment) — pgmq queue
-- creation follows the same is_queue_available() best-effort pattern.
-- ---------------------------------------------------------------------------

do $$
begin
  if public.is_queue_available() then
    perform pgmq.create('crm_sync');
    perform pgmq.create('outbound_webhooks');
  end if;
exception when others then
  raise notice 'Could not create Milestone 8 queues: %', sqlerrm;
end;
$$;

create or replace function public.enqueue_integration_job(
  p_organization_id uuid,
  p_queue_name text,
  p_job_type text,
  p_dedupe_key text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_msg_id bigint;
begin
  insert into public.integration_jobs (organization_id, queue_name, job_type, payload, dedupe_key)
  values (p_organization_id, p_queue_name, p_job_type, p_payload, p_dedupe_key)
  on conflict (queue_name, dedupe_key) do nothing
  returning id into v_job_id;

  if v_job_id is null then
    return null;
  end if;

  if public.is_queue_available() then
    select pgmq.send(p_queue_name, jsonb_build_object('job_id', v_job_id, 'job_type', p_job_type) || p_payload)
      into v_msg_id;
    update public.integration_jobs set queue_msg_id = v_msg_id where id = v_job_id;
  end if;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_integration_job(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_integration_job(uuid, text, text, text, jsonb) to service_role;

create or replace function public.dequeue_integration_jobs(
  p_queue_name text, p_batch_size int default 10, p_visibility_timeout_seconds int default 30
)
returns table (msg_id bigint, payload jsonb, read_ct int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_queue_available() then
    return;
  end if;
  return query
    select m.msg_id, m.message as payload, m.read_ct
    from pgmq.read(p_queue_name, p_visibility_timeout_seconds, p_batch_size) m;
end;
$$;

create or replace function public.ack_integration_job(p_queue_name text, p_msg_id bigint, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.integration_jobs set status = 'completed' where id = p_job_id;
  if public.is_queue_available() then
    perform pgmq.delete(p_queue_name, p_msg_id);
  end if;
end;
$$;

create or replace function public.fail_integration_job(
  p_queue_name text, p_msg_id bigint, p_job_id uuid, p_error text, p_max_attempts int default 5
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
  v_next_delay_minutes int;
begin
  select attempt_count into v_attempts from public.integration_jobs where id = p_job_id;

  -- Retry schedule from spec §43: 1m, 5m, 30m, 2h, 12h. Applies to both
  -- crm_sync and outbound_webhooks — the same "give up eventually" shape
  -- spec §42 item 9 asks for on the CRM side too.
  v_next_delay_minutes := case v_attempts
    when 0 then 1
    when 1 then 5
    when 2 then 30
    when 3 then 120
    else 720
  end;

  update public.integration_jobs
  set attempt_count = attempt_count + 1, last_error = p_error,
      status = case when attempt_count + 1 >= p_max_attempts then 'dead_letter' else 'retrying' end,
      next_retry_at = now() + make_interval(mins => v_next_delay_minutes)
  where id = p_job_id
  returning attempt_count into v_attempts;

  if public.is_queue_available() then
    -- Always archive the failed message, dead-lettered or merely retrying:
    -- these retry delays are human-scale (minutes to 12 hours), unlike
    -- assignment_notifications' short pgmq-visibility-timeout retries, so
    -- the message must not sit claimable in the queue for that whole
    -- window. drain_integration_retries() below re-sends a fresh message
    -- once next_retry_at has passed.
    perform pgmq.archive(p_queue_name, p_msg_id);
  end if;
end;
$$;

revoke all on function public.dequeue_integration_jobs(text, int, int) from public, anon, authenticated;
revoke all on function public.ack_integration_job(text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.fail_integration_job(text, bigint, uuid, text, int) from public, anon, authenticated;
grant execute on function public.dequeue_integration_jobs(text, int, int) to service_role;
grant execute on function public.ack_integration_job(text, bigint, uuid) to service_role;
grant execute on function public.fail_integration_job(text, bigint, uuid, text, int) to service_role;

-- drain_integration_retries: called by Cron every 5 minutes per queue.
-- Re-sends any job whose retry delay has elapsed back onto its own pgmq
-- queue (docs/background-processing.md's "drain-crm-sync-retries" /
-- "drain-webhook-retries" — realized as one parameterized function against
-- the shared integration_jobs ledger rather than a literal third queue).
create or replace function public.drain_integration_retries(p_queue_name text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_count int := 0;
begin
  for v_job in
    select id, organization_id, job_type, payload
    from public.integration_jobs
    where queue_name = p_queue_name and status = 'retrying' and next_retry_at <= now()
  loop
    update public.integration_jobs set status = 'queued' where id = v_job.id;
    if public.is_queue_available() then
      perform pgmq.send(
        p_queue_name,
        jsonb_build_object('job_id', v_job.id, 'job_type', v_job.job_type) || v_job.payload
      );
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.run_drain_crm_sync_retries()
returns int
language sql
security definer
set search_path = public
as $$
  select public.drain_integration_retries('crm_sync');
$$;

create or replace function public.run_drain_webhook_retries()
returns int
language sql
security definer
set search_path = public
as $$
  select public.drain_integration_retries('outbound_webhooks');
$$;

revoke all on function public.drain_integration_retries(text) from public, anon, authenticated;
revoke all on function public.run_drain_crm_sync_retries() from public, anon, authenticated;
revoke all on function public.run_drain_webhook_retries() from public, anon, authenticated;
grant execute on function public.drain_integration_retries(text) to service_role;
grant execute on function public.run_drain_crm_sync_retries() to service_role;
grant execute on function public.run_drain_webhook_retries() to service_role;

-- ---------------------------------------------------------------------------
-- integration_connections: one row per configured CRM connection.
-- credentials_encrypted is opaque bytea produced by lib/crypto/secret-box.ts
-- (AES-256-GCM, keyed by the server-only WEBHOOK_ENCRYPTION_KEY env var) —
-- Postgres never sees a plaintext credential, not even as a function
-- argument, so it can never appear in a query log (docs/decisions.md ADR-051).
-- ---------------------------------------------------------------------------

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  credentials_encrypted text,
  settings jsonb not null default '{}'::jsonb,
  connected_by_user_id uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_org_provider_unique unique (organization_id, provider)
);

comment on table public.integration_connections is
  'Per docs/database-schema.md §15 / spec §42. org_admin CUD only. '
  'settings is provider-configuration jsonb (base URL, owner-mapping rules, '
  'subscribed lead-status pushbacks) — never credentials, which live only '
  'in credentials_encrypted.';

create index integration_connections_organization_id_idx on public.integration_connections (organization_id);

create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row
  execute function public.set_updated_at();

alter table public.integration_connections enable row level security;

create policy integration_connections_all_org_admin
  on public.integration_connections for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- integration_field_mappings: which internal field (lead default field or
-- custom variable) maps to which CRM field, with an optional transformation
-- reusing the same twelve transformations as lead-intake field mapping
-- (src/modules/field-mapping/transformations.ts) — spec §42 items 3-4.
-- ---------------------------------------------------------------------------

create table public.integration_field_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_connection_id uuid not null references public.integration_connections(id) on delete cascade,
  source_field text not null,
  crm_field text not null,
  transformation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_field_mappings_connection_source_unique unique (integration_connection_id, source_field)
);

comment on table public.integration_field_mappings is
  'Per docs/database-schema.md §15. source_field is either a default lead '
  'field name (e.g. "email") or "custom:<internal_key>" for a custom '
  'variable — resolved by modules/integrations/sync-payload.ts.';

create index integration_field_mappings_connection_id_idx
  on public.integration_field_mappings (integration_connection_id);

create trigger integration_field_mappings_set_updated_at
  before update on public.integration_field_mappings
  for each row
  execute function public.set_updated_at();

alter table public.integration_field_mappings enable row level security;

create policy integration_field_mappings_all_org_admin
  on public.integration_field_mappings for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- external_record_links: prevents duplicate CRM contact creation under
-- retry (spec §42 item 10, §51 constraint 7) — the unique constraint below
-- is the actual duplicate-prevention mechanism, not application logic.
-- ---------------------------------------------------------------------------

create table public.external_record_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_connection_id uuid not null references public.integration_connections(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider text not null,
  external_record_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_record_links_provider_org_external_unique unique (provider, organization_id, external_record_id),
  constraint external_record_links_connection_lead_unique unique (integration_connection_id, lead_id)
);

comment on table public.external_record_links is
  'Per docs/database-schema.md §15 / spec §51 constraint 7. The two unique '
  'constraints together guarantee at most one CRM contact per lead per '
  'connection, and that no two leads ever claim the same external record id.';

create index external_record_links_organization_id_idx on public.external_record_links (organization_id);
create index external_record_links_lead_id_idx on public.external_record_links (lead_id);

create trigger external_record_links_set_updated_at
  before update on public.external_record_links
  for each row
  execute function public.set_updated_at();

alter table public.external_record_links enable row level security;

create policy external_record_links_select_org_admin
  on public.external_record_links for select to authenticated
  using (public.is_org_admin(organization_id));

-- No INSERT/UPDATE policy for authenticated/anon — written exclusively by
-- the service-role crm_sync consumer.

-- ---------------------------------------------------------------------------
-- integration_logs: safe, redacted record of every CRM sync attempt
-- (spec §44). request_summary/response_summary must never contain
-- credentials, tokens, or raw lead PII — enforced at the application layer
-- that writes these rows (modules/integrations/redact.ts), not by the
-- database, matching how submission_logs' own redaction works.
-- ---------------------------------------------------------------------------

create table public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_job_id uuid references public.integration_jobs(id) on delete set null,
  provider text not null,
  event_type text not null,
  lead_id uuid references public.leads(id) on delete set null,
  request_summary jsonb,
  response_summary jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'retrying', 'dead_letter', 'resolved')),
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint integration_logs_job_unique unique (integration_job_id)
);

comment on table public.integration_logs is
  'Per spec §44. One row per CRM sync job, upserted (by integration_job_id) '
  'on each attempt so attempt_count/status stay current without growing '
  'unboundedly per retry. resolved is an admin-only terminal state for a '
  'failed sync the admin fixed manually outside this system.';

create index integration_logs_organization_id_idx on public.integration_logs (organization_id, created_at desc);
create index integration_logs_job_id_idx on public.integration_logs (integration_job_id);

alter table public.integration_logs enable row level security;

create policy integration_logs_select_org_admin
  on public.integration_logs for select to authenticated
  using (public.is_org_admin(organization_id));

-- No INSERT/UPDATE policy for authenticated/anon — written exclusively by
-- the service-role crm_sync consumer and the mark_integration_log_resolved
-- function below.

-- ---------------------------------------------------------------------------
-- webhook_endpoints / webhook_deliveries (spec §43).
-- secret_encrypted uses the same lib/crypto/secret-box.ts mechanism as CRM
-- credentials — the raw secret is generated and shown once at creation
-- time, exactly like lead_sources.source_token_hash's issuance flow.
-- ---------------------------------------------------------------------------

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_encrypted text not null,
  subscribed_events text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.webhook_endpoints is
  'Per docs/database-schema.md §16 / spec §43. org_admin CUD only. '
  'subscribed_events restricts which of the 8 event types are ever '
  'enqueued for this endpoint (docs/decisions.md).';

create index webhook_endpoints_organization_id_idx on public.webhook_endpoints (organization_id);

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row
  execute function public.set_updated_at();

alter table public.webhook_endpoints enable row level security;

create policy webhook_endpoints_all_org_admin
  on public.webhook_endpoints for all to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  integration_job_id uuid references public.integration_jobs(id) on delete set null,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'delivered', 'failed', 'retrying', 'dead_letter')),
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  last_response_status int,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint webhook_deliveries_endpoint_event_unique unique (webhook_endpoint_id, event_id)
);

comment on table public.webhook_deliveries is
  'Per docs/database-schema.md §16 / spec §43. The unique constraint on '
  '(webhook_endpoint_id, event_id) is the actual idempotent-delivery / '
  'replay-protection guarantee — a redelivered job for the same logical '
  'event upserts this same row instead of creating a duplicate.';

create index webhook_deliveries_organization_id_idx on public.webhook_deliveries (organization_id, created_at desc);
create index webhook_deliveries_endpoint_id_idx on public.webhook_deliveries (webhook_endpoint_id);

alter table public.webhook_deliveries enable row level security;

create policy webhook_deliveries_select_org_admin
  on public.webhook_deliveries for select to authenticated
  using (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Inbound CRM webhook support: two narrow SECURITY DEFINER functions
-- granted to `anon`, mirroring resolve_lead_source/record_lead_submission's
-- pre-auth pattern (docs/decisions.md ADR-011) rather than letting
-- POST /api/webhooks/crm/[connectionId] use the service-role client — the
-- ESLint import-boundary rule (ADR-022) exists specifically to keep public,
-- unauthenticated routes off that client. There is no end user behind a
-- CRM's own webhook call, so real authorization comes entirely from the
-- adapter's signature verification inside handleWebhook before either of
-- these is ever called; these functions never re-derive that check.
-- ---------------------------------------------------------------------------

create or replace function public.get_connection_for_inbound_webhook(p_connection_id uuid)
returns table (
  organization_id uuid, provider text, settings jsonb, credentials_encrypted text
)
language sql
stable
security definer
set search_path = public
as $$
  select organization_id, provider, settings, credentials_encrypted
  from public.integration_connections
  where id = p_connection_id and status = 'connected';
$$;

revoke all on function public.get_connection_for_inbound_webhook(uuid) from public;
grant execute on function public.get_connection_for_inbound_webhook(uuid) to anon, authenticated;

-- Duplicates a small amount of update_lead_status's logic rather than
-- calling it directly: that function is a plain (non-SECURITY-DEFINER)
-- function relying on the caller's own RLS/auth.uid() context, which an
-- anonymous, signature-verified CRM request does not have — composing the
-- two would leave the actual authorization semantics ambiguous. The two
-- entry points intentionally stay separate, the same reasoning as
-- route_lead vs manually_assign_lead in Milestone 5/6.
create or replace function public.apply_inbound_crm_status_change(
  p_connection_id uuid, p_external_record_id text, p_crm_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection record;
  v_lead_id uuid;
  v_mapped_status text;
  v_old_status text;
  v_status_valid boolean;
begin
  select organization_id, settings into v_connection
  from public.integration_connections
  where id = p_connection_id and status = 'connected';

  if v_connection.organization_id is null then
    return jsonb_build_object('applied', false, 'reason', 'connection_not_found');
  end if;

  select lead_id into v_lead_id
  from public.external_record_links
  where integration_connection_id = p_connection_id and external_record_id = p_external_record_id;

  if v_lead_id is null then
    return jsonb_build_object('applied', false, 'reason', 'no_linked_lead');
  end if;

  v_mapped_status := v_connection.settings -> 'statusMapping' ->> p_crm_status;
  if v_mapped_status is null then
    return jsonb_build_object('applied', false, 'reason', 'status_not_mapped', 'lead_id', v_lead_id);
  end if;

  select exists (
    select 1 from public.lead_status_definitions
    where organization_id = v_connection.organization_id and key = v_mapped_status and active = true
  ) into v_status_valid;

  if not v_status_valid then
    return jsonb_build_object('applied', false, 'reason', 'invalid_status', 'lead_id', v_lead_id);
  end if;

  select lead_status into v_old_status from public.leads where id = v_lead_id;
  if v_old_status = v_mapped_status then
    return jsonb_build_object('applied', true, 'reason', 'no_op', 'lead_id', v_lead_id);
  end if;

  update public.leads set lead_status = v_mapped_status where id = v_lead_id;

  insert into public.lead_status_history (organization_id, lead_id, from_status, to_status, changed_by_user_id)
  values (v_connection.organization_id, v_lead_id, v_old_status, v_mapped_status, null);

  insert into public.activities (organization_id, lead_id, activity_type, actor_user_id, metadata)
  values (v_connection.organization_id, v_lead_id, 'status_changed', null,
    jsonb_build_object('to_status', v_mapped_status, 'source', 'crm_webhook'));

  return jsonb_build_object('applied', true, 'lead_id', v_lead_id, 'status', v_mapped_status);
end;
$$;

revoke all on function public.apply_inbound_crm_status_change(uuid, text, text) from public;
grant execute on function public.apply_inbound_crm_status_change(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- mark_integration_log_resolved / retry_integration_job: the two org_admin-
-- facing actions from spec §44 ("retry failed operations", "mark an item
-- resolved"). Both are SECURITY DEFINER with an explicit is_org_admin check
-- inside — callable by `authenticated`, unlike the service-role-only
-- functions above.
-- ---------------------------------------------------------------------------

create or replace function public.mark_integration_log_resolved(p_log_id uuid)
returns public.integration_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.integration_logs;
begin
  select * into v_log from public.integration_logs where id = p_log_id;
  if v_log.id is null then
    raise exception 'integration log % not found', p_log_id using errcode = '02000';
  end if;
  if not public.is_org_admin(v_log.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.integration_logs set status = 'resolved', completed_at = now()
  where id = p_log_id
  returning * into v_log;

  return v_log;
end;
$$;

create or replace function public.retry_integration_job(p_job_id uuid)
returns public.integration_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.integration_jobs;
begin
  select * into v_job from public.integration_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'integration job % not found', p_job_id using errcode = '02000';
  end if;
  if not public.is_org_admin(v_job.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_job.status not in ('failed', 'dead_letter', 'retrying') then
    raise exception 'only a failed, retrying, or dead-lettered job can be manually retried'
      using errcode = '23514';
  end if;

  update public.integration_jobs
  set status = 'queued', next_retry_at = null
  where id = p_job_id
  returning * into v_job;

  if public.is_queue_available() then
    perform pgmq.send(
      v_job.queue_name,
      jsonb_build_object('job_id', v_job.id, 'job_type', v_job.job_type) || v_job.payload
    );
  end if;

  return v_job;
end;
$$;

revoke all on function public.mark_integration_log_resolved(uuid) from public, anon;
revoke all on function public.retry_integration_job(uuid) from public, anon;
grant execute on function public.mark_integration_log_resolved(uuid) to authenticated;
grant execute on function public.retry_integration_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lifecycle-event triggers: the actual producers for both new queues.
-- Implemented as AFTER triggers on leads/assignments/lead_status_history
-- rather than editing route_lead/accept_assignment/decline_assignment/
-- reassign_lead/update_lead_status directly (docs/decisions.md ADR-052) —
-- this milestone adds zero lines to any of those already-tested,
-- concurrency-sensitive functions. An AFTER trigger fires inside the same
-- transaction as the write that caused it, so enqueue failures would abort
-- the whole transaction the same as any other trigger — but enqueue_
-- integration_job's only possible failure mode is a constraint violation on
-- well-formed input, which cannot happen here since every value it's given
-- comes straight from the row that was just written.
-- ---------------------------------------------------------------------------

create or replace function public.trg_leads_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_integration_job(
    new.organization_id, 'outbound_webhooks', 'lead.created',
    'lead.created:' || new.id::text,
    jsonb_build_object('event_type', 'lead.created', 'lead_id', new.id)
  );
  perform public.enqueue_integration_job(
    new.organization_id, 'crm_sync', 'sync_contact',
    'sync_contact:' || new.id::text || ':' || new.updated_at::text,
    jsonb_build_object('lead_id', new.id)
  );
  return new;
end;
$$;

create trigger leads_after_insert_enqueue_integrations
  after insert on public.leads
  for each row
  execute function public.trg_leads_after_insert();

create or replace function public.trg_assignments_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_count int;
  v_event_type text;
begin
  select count(*) into v_prior_count
  from public.assignments
  where lead_id = new.lead_id and id <> new.id;

  v_event_type := case when v_prior_count = 0 then 'lead.assigned' else 'lead.reassigned' end;

  perform public.enqueue_integration_job(
    new.organization_id, 'outbound_webhooks', v_event_type,
    v_event_type || ':' || new.id::text,
    jsonb_build_object('event_type', v_event_type, 'lead_id', new.lead_id, 'assignment_id', new.id)
  );
  -- Re-sync the contact: ownership (assigned user) may have changed.
  perform public.enqueue_integration_job(
    new.organization_id, 'crm_sync', 'sync_contact',
    'sync_contact:' || new.lead_id::text || ':' || new.created_at::text,
    jsonb_build_object('lead_id', new.lead_id, 'assignment_id', new.id)
  );
  return new;
end;
$$;

create trigger assignments_after_insert_enqueue_integrations
  after insert on public.assignments
  for each row
  execute function public.trg_assignments_after_insert();

create or replace function public.trg_assignments_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.enqueue_integration_job(
        new.organization_id, 'outbound_webhooks', 'lead.accepted',
        'lead.accepted:' || new.id::text,
        jsonb_build_object('event_type', 'lead.accepted', 'lead_id', new.lead_id, 'assignment_id', new.id)
      );
      perform public.enqueue_integration_job(
        new.organization_id, 'crm_sync', 'sync_accepted_status',
        'sync_accepted_status:' || new.id::text,
        jsonb_build_object('lead_id', new.lead_id, 'assignment_id', new.id)
      );
    elsif new.status = 'declined' then
      perform public.enqueue_integration_job(
        new.organization_id, 'outbound_webhooks', 'lead.declined',
        'lead.declined:' || new.id::text,
        jsonb_build_object('event_type', 'lead.declined', 'lead_id', new.lead_id, 'assignment_id', new.id)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger assignments_after_update_enqueue_integrations
  after update of status on public.assignments
  for each row
  execute function public.trg_assignments_after_update();

create or replace function public.trg_lead_status_history_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_integration_job(
    new.organization_id, 'outbound_webhooks', 'lead.status_changed',
    'lead.status_changed:' || new.id::text,
    jsonb_build_object(
      'event_type', 'lead.status_changed', 'lead_id', new.lead_id,
      'from_status', new.from_status, 'to_status', new.to_status
    )
  );

  if new.to_status = 'converted' then
    perform public.enqueue_integration_job(
      new.organization_id, 'outbound_webhooks', 'lead.converted',
      'lead.converted:' || new.id::text,
      jsonb_build_object('event_type', 'lead.converted', 'lead_id', new.lead_id)
    );
  elsif new.to_status = 'lost' then
    perform public.enqueue_integration_job(
      new.organization_id, 'outbound_webhooks', 'lead.lost',
      'lead.lost:' || new.id::text,
      jsonb_build_object('event_type', 'lead.lost', 'lead_id', new.lead_id)
    );
  end if;

  return new;
end;
$$;

create trigger lead_status_history_after_insert_enqueue_webhook
  after insert on public.lead_status_history
  for each row
  execute function public.trg_lead_status_history_after_insert();

-- ---------------------------------------------------------------------------
-- Cron wiring: mirrors Milestone 6's pattern exactly (pg_net HTTP calls to
-- internal queue-processing routes for the two consumers that need
-- TypeScript adapter logic; the two retriable-drain functions and the
-- routing/expiration-style sweeps are plain SQL, called directly).
-- ---------------------------------------------------------------------------

do $$
begin
  if public.is_cron_available() then
    perform cron.schedule('drain-crm-sync-retries', '*/5 * * * *', $cron$select public.run_drain_crm_sync_retries();$cron$);
    perform cron.schedule('drain-webhook-retries', '*/5 * * * *', $cron$select public.run_drain_webhook_retries();$cron$);

    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule(
        'process-crm-sync',
        '* * * * *',
        $cron$
        select net.http_post(
          url => current_setting('app.settings.app_url', true) || '/api/internal/queue/process-crm-sync',
          headers => jsonb_build_object('x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body => '{}'::jsonb
        )
        where current_setting('app.settings.app_url', true) is not null
          and current_setting('app.settings.cron_secret', true) is not null;
        $cron$
      );
      perform cron.schedule(
        'process-outbound-webhooks',
        '* * * * *',
        $cron$
        select net.http_post(
          url => current_setting('app.settings.app_url', true) || '/api/internal/queue/process-outbound-webhooks',
          headers => jsonb_build_object('x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body => '{}'::jsonb
        )
        where current_setting('app.settings.app_url', true) is not null
          and current_setting('app.settings.cron_secret', true) is not null;
        $cron$
      );
    end if;
  end if;
exception when others then
  raise notice 'Could not schedule Milestone 8 cron jobs: %', sqlerrm;
end;
$$;
