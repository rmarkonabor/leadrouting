-- Fixes a real deployment blocker found while running the deployment
-- runbook against production: the Milestone 6/8 cron-scheduling comments
-- say `app.settings.app_url` / `app.settings.cron_secret` must be
-- configured via "Database Settings > Custom Postgres Config, or via
-- `alter database ... set ...`" — but neither path actually works on a
-- real hosted Supabase project. `alter database postgres set
-- app.settings.app_url = ...` fails with `permission denied to set
-- parameter "app.settings.app_url"` even for the project owner (Supabase
-- reserves ALTER DATABASE-level custom GUCs for its own management
-- plane on shared infrastructure), and the dashboard's Database Settings
-- page has no "Custom Postgres Config" section — that UI does not exist
-- on current Supabase dashboards. So every `process-assignment-
-- notifications` / `process-crm-sync` / `process-outbound-webhooks` cron
-- job has been silently no-op'ing on every real project since Milestone
-- 6, guarded by the `where current_setting(...) is not null` clause
-- that was meant to be a temporary safety net, not the permanent state.
--
-- Fix: replace the two `current_setting('app.settings.*', true)` lookups
-- with a plain settings table in a schema outside the Data API's reach,
-- `app_private.cron_http_config`. A regular table UPDATE is an ordinary
-- privileged operation the project owner already has — unlike
-- `ALTER DATABASE`, nothing platform-reserved blocks it.
--
-- `app_private` is deliberately not `public`: Milestone 9's table-grant
-- fix (`20260813090000_grant_table_privileges_to_data_api_roles.sql`)
-- grants `authenticated`/`service_role` SELECT/INSERT/UPDATE/DELETE on
-- every table in `public` (present and future, via `alter default
-- privileges`). A secret used to authenticate Cron's calls into the app
-- must never be reachable that way — putting it in a schema that
-- migration's `in schema public` scope never touches, plus an explicit
-- revoke below as defense in depth, keeps it out of reach of every
-- Data API role. Only the table owner (the `postgres` role migrations
-- and `cron.schedule` jobs run as) can read or write it — the same role
-- an operator uses when running the UPDATE from the Supabase SQL Editor.
-- No table grant here is needed for the app itself: no TypeScript code
-- path reads this table, only the Cron job bodies below do.

create schema if not exists app_private;

comment on schema app_private is
  'Configuration read only by Postgres-side jobs (Cron), never by the '
  'Data API or app code. Not in schema public, so the blanket '
  'authenticated/service_role grants in '
  '20260813090000_grant_table_privileges_to_data_api_roles.sql never '
  'apply here.';

create table if not exists app_private.cron_http_config (
  id boolean primary key default true,
  app_url text,
  cron_secret text,
  constraint cron_http_config_singleton check (id)
);

comment on table app_private.cron_http_config is
  'Single-row config for the pg_net HTTP calls the Cron jobs below make '
  'into the app''s internal queue-processing routes. Set per environment '
  'via: update app_private.cron_http_config set app_url = ..., '
  'cron_secret = ... where id; (run from the Supabase SQL Editor — this '
  'is a normal table UPDATE, not the ALTER DATABASE that Supabase '
  'rejects). cron_secret must exactly match that environment''s '
  'Vercel CRON_SECRET.';

revoke all on app_private.cron_http_config from public, anon, authenticated, service_role;

insert into app_private.cron_http_config (id, app_url, cron_secret)
values (true, null, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Re-register the three HTTP-calling cron jobs to read from the table
-- above instead of current_setting('app.settings.*'). The plain-SQL jobs
-- (expire-assignments, send-expiration-warnings, drain-crm-sync-retries,
-- drain-webhook-retries, refresh-routing-health-metrics) never used
-- app.settings and are untouched.
-- ---------------------------------------------------------------------------

do $$
begin
  if public.is_cron_available() then
    begin
      perform cron.unschedule('process-assignment-notifications');
    exception when others then
      raise notice 'process-assignment-notifications was not scheduled: %', sqlerrm;
    end;
    begin
      perform cron.unschedule('process-crm-sync');
    exception when others then
      raise notice 'process-crm-sync was not scheduled: %', sqlerrm;
    end;
    begin
      perform cron.unschedule('process-outbound-webhooks');
    exception when others then
      raise notice 'process-outbound-webhooks was not scheduled: %', sqlerrm;
    end;

    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule(
        'process-assignment-notifications',
        '* * * * *',
        $cron$
        select net.http_post(
          url => (select app_url from app_private.cron_http_config where id) || '/api/internal/queue/process-assignment-notifications',
          headers => jsonb_build_object('x-cron-secret', (select cron_secret from app_private.cron_http_config where id)),
          body => '{}'::jsonb
        )
        where exists (
          select 1 from app_private.cron_http_config
          where id and app_url is not null and cron_secret is not null
        );
        $cron$
      );
      perform cron.schedule(
        'process-crm-sync',
        '* * * * *',
        $cron$
        select net.http_post(
          url => (select app_url from app_private.cron_http_config where id) || '/api/internal/queue/process-crm-sync',
          headers => jsonb_build_object('x-cron-secret', (select cron_secret from app_private.cron_http_config where id)),
          body => '{}'::jsonb
        )
        where exists (
          select 1 from app_private.cron_http_config
          where id and app_url is not null and cron_secret is not null
        );
        $cron$
      );
      perform cron.schedule(
        'process-outbound-webhooks',
        '* * * * *',
        $cron$
        select net.http_post(
          url => (select app_url from app_private.cron_http_config where id) || '/api/internal/queue/process-outbound-webhooks',
          headers => jsonb_build_object('x-cron-secret', (select cron_secret from app_private.cron_http_config where id)),
          body => '{}'::jsonb
        )
        where exists (
          select 1 from app_private.cron_http_config
          where id and app_url is not null and cron_secret is not null
        );
        $cron$
      );
    end if;
  end if;
exception when others then
  raise notice 'Could not re-register HTTP-calling cron jobs: %', sqlerrm;
end;
$$;
