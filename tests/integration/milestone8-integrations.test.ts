import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres tests for Milestone 8 (lifecycle-event triggers, the
 * generic integration_jobs queue functions, external_record_links
 * duplicate prevention, retry/dead-letter/drain, inbound CRM webhook
 * status mapping, and cross-org RLS isolation for every new table). See
 * tests/integration/README.md — skipped automatically without
 * TEST_DATABASE_URL. The TypeScript-level webhook signing/replay-
 * protection and CRM duplicate-record-on-retry scenarios are covered at
 * the unit level (tests/unit/webhooks, tests/unit/integrations) with test
 * adapters, per the kickoff's "never connect a real production CRM during
 * automated testing."
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 8 integrations", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000701";
  const orgBId = "00000000-0000-4000-8000-000000000702";
  const adminAId = "00000000-0000-4000-8000-000000000a21";
  const adminBId = "00000000-0000-4000-8000-000000000a22";
  const sourceId = "00000000-0000-4000-8000-000000000b21";
  const connectionId = "00000000-0000-4000-8000-000000000c21";

  let leadCounter = 0;
  function nextLeadId(): string {
    leadCounter++;
    return `00000000-0000-4000-8000-0000002${(10000 + leadCounter).toString().padStart(4, "0")}`;
  }

  async function asUser(userId: string) {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)`,
      [userId],
    );
  }

  async function asSuperuser() {
    await client.query("reset role");
  }

  /**
   * A failed statement aborts the whole transaction until a ROLLBACK; when
   * a test needs to assert a query throws and then keep issuing statements
   * in the same test body, the throwing call must run inside its own
   * savepoint so the abort clears without discarding earlier test setup.
   */
  async function expectRejectionInSavepoint(
    makeQuery: () => Promise<unknown>,
    match?: RegExp,
  ) {
    await client.query("savepoint expect_reject");
    if (match) {
      await expect(makeQuery()).rejects.toThrow(match);
    } else {
      await expect(makeQuery()).rejects.toThrow();
    }
    await client.query("rollback to savepoint expect_reject");
  }

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-m8@example.test"],
      [adminBId, "admin-b-m8@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm8-org-a'), ($2, 'Org B', 'm8-org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );
    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values
       ($1, $2, 'org_admin', 'active'), ($3, $4, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, adminAId, orgBId, adminBId],
    );
    await client.query(
      `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
       values ($1, $2, 'src', 'api', 'm8-hash') on conflict (id) do nothing`,
      [sourceId, orgAId],
    );
    await client.query(`select public.seed_default_lead_statuses($1)`, [orgAId]);
    await client.query(
      `insert into public.integration_connections (id, organization_id, provider, status)
       values ($1, $2, 'generic_http', 'connected') on conflict (id) do nothing`,
      [connectionId, orgAId],
    );
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  beforeEach(async () => {
    await client.query("savepoint test_savepoint");
  });

  afterEach(async () => {
    await client.query("rollback to savepoint test_savepoint");
    await asSuperuser();
  });

  async function insertLead(leadId: string) {
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, `${leadId}@x.test`, sourceId],
    );
  }

  it("lead insert enqueues lead.created (outbound_webhooks) and sync_contact (crm_sync)", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);

    const rows = await client.query(
      `select queue_name, job_type from public.integration_jobs where dedupe_key like $1 order by job_type`,
      [`%${leadId}%`],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { queue_name: "outbound_webhooks", job_type: "lead.created" },
        { queue_name: "crm_sync", job_type: "sync_contact" },
      ]),
    );
  });

  it("a second assignment for the same lead enqueues lead.reassigned, not lead.assigned", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);
    await client.query(
      `insert into public.assignments (id, organization_id, lead_id, status, assignment_algorithm, acceptance_deadline_at)
       values (gen_random_uuid(), $1, $2, 'declined', 'direct', now() - interval '1 hour')`,
      [orgAId, leadId],
    );

    const secondAssignmentId = "00000000-0000-4000-8000-000000009999";
    await client.query(
      `insert into public.assignments (id, organization_id, lead_id, status, assignment_algorithm, acceptance_deadline_at)
       values ($1, $2, $3, 'pending', 'direct', now() + interval '30 minutes')`,
      [secondAssignmentId, orgAId, leadId],
    );

    const rows = await client.query(
      `select job_type from public.integration_jobs where dedupe_key = $1`,
      [`lead.reassigned:${secondAssignmentId}`],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("an accepted assignment enqueues lead.accepted and sync_accepted_status", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);
    const assignmentId = "00000000-0000-4000-8000-000000008888";
    await client.query(
      `insert into public.assignments (id, organization_id, lead_id, status, assignment_algorithm, acceptance_deadline_at)
       values ($1, $2, $3, 'pending', 'direct', now() + interval '30 minutes')`,
      [assignmentId, orgAId, leadId],
    );

    await client.query(
      `update public.assignments set status = 'accepted' where id = $1`,
      [assignmentId],
    );

    const rows = await client.query(
      `select queue_name, job_type from public.integration_jobs where dedupe_key like $1 order by job_type`,
      [`%${assignmentId}%`],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { queue_name: "outbound_webhooks", job_type: "lead.accepted" },
        { queue_name: "crm_sync", job_type: "sync_accepted_status" },
      ]),
    );
  });

  it("a lead_status_history insert to 'converted' enqueues both lead.status_changed and lead.converted", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);

    await client.query(
      `insert into public.lead_status_history (organization_id, lead_id, from_status, to_status, changed_by_user_id)
       values ($1, $2, 'new', 'converted', $3)`,
      [orgAId, leadId, adminAId],
    );

    // dedupe keys are keyed by the history row id, not the lead id directly.
    const jobTypes = (
      await client.query(
        `select ij.job_type from public.integration_jobs ij
         join public.lead_status_history h on ij.dedupe_key like ('%' || h.id::text)
         where h.lead_id = $1`,
        [leadId],
      )
    ).rows.map((r) => r.job_type);
    expect(jobTypes).toEqual(
      expect.arrayContaining(["lead.status_changed", "lead.converted"]),
    );
  });

  it("enqueue_integration_job is idempotent: the same dedupe key never creates two jobs", async () => {
    const first = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-dedupe-test', '{}'::jsonb) as id`,
      [orgAId],
    );
    const second = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-dedupe-test', '{}'::jsonb) as id`,
      [orgAId],
    );
    expect(first.rows[0].id).not.toBeNull();
    expect(second.rows[0].id).toBeNull();

    const count = await client.query(
      `select count(*)::int as n from public.integration_jobs where dedupe_key = 'm8-dedupe-test'`,
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("fail_integration_job schedules a retry, then dead-letters after max attempts", async () => {
    const jobIdResult = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-fail-test', '{}'::jsonb) as id`,
      [orgAId],
    );
    const jobId = jobIdResult.rows[0].id;

    await client.query(
      `select public.fail_integration_job('crm_sync', null, $1, 'boom', 2)`,
      [jobId],
    );
    const afterFirstFail = await client.query(
      `select status, attempt_count from public.integration_jobs where id = $1`,
      [jobId],
    );
    expect(afterFirstFail.rows[0]).toMatchObject({
      status: "retrying",
      attempt_count: 1,
    });

    await client.query(
      `select public.fail_integration_job('crm_sync', null, $1, 'boom again', 2)`,
      [jobId],
    );
    const afterSecondFail = await client.query(
      `select status from public.integration_jobs where id = $1`,
      [jobId],
    );
    expect(afterSecondFail.rows[0].status).toBe("dead_letter");
  });

  it("drain_integration_retries re-queues only jobs whose retry delay has elapsed", async () => {
    const dueJob = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-drain-due', '{}'::jsonb) as id`,
      [orgAId],
    );
    const notDueJob = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-drain-not-due', '{}'::jsonb) as id`,
      [orgAId],
    );

    await client.query(
      `update public.integration_jobs set status = 'retrying', next_retry_at = now() - interval '1 minute' where id = $1`,
      [dueJob.rows[0].id],
    );
    await client.query(
      `update public.integration_jobs set status = 'retrying', next_retry_at = now() + interval '1 hour' where id = $1`,
      [notDueJob.rows[0].id],
    );

    const drained = await client.query(`select public.run_drain_crm_sync_retries() as n`);
    expect(drained.rows[0].n).toBe(1);

    const statuses = await client.query(
      `select id, status from public.integration_jobs where id in ($1, $2)`,
      [dueJob.rows[0].id, notDueJob.rows[0].id],
    );
    const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
    expect(byId[dueJob.rows[0].id]).toBe("queued");
    expect(byId[notDueJob.rows[0].id]).toBe("retrying");
  });

  it("retry_integration_job (manual retry) requires org_admin and rejects a job that isn't failed/retrying/dead-lettered", async () => {
    const jobResult = await client.query(
      `select public.enqueue_integration_job($1, 'crm_sync', 'sync_contact', 'm8-manual-retry', '{}'::jsonb) as id`,
      [orgAId],
    );
    const jobId = jobResult.rows[0].id;

    await asUser(adminAId);
    // Still 'queued' — not eligible for manual retry.
    await expectRejectionInSavepoint(() =>
      client.query(`select public.retry_integration_job($1)`, [jobId]),
    );
    await asSuperuser();

    await client.query(
      `update public.integration_jobs set status = 'dead_letter' where id = $1`,
      [jobId],
    );

    await asUser(adminBId);
    await expectRejectionInSavepoint(
      () => client.query(`select public.retry_integration_job($1)`, [jobId]),
      /not authorized/,
    );
    await asSuperuser();

    await asUser(adminAId);
    const result = await client.query(
      `select (public.retry_integration_job($1)).status as status`,
      [jobId],
    );
    expect(result.rows[0].status).toBe("queued");
  });

  it("mark_integration_log_resolved requires org_admin of the log's own organization", async () => {
    const logResult = await client.query(
      `insert into public.integration_logs (organization_id, provider, event_type, status)
       values ($1, 'generic_http', 'sync_contact', 'failed') returning id`,
      [orgAId],
    );
    const logId = logResult.rows[0].id;

    await asUser(adminBId);
    await expectRejectionInSavepoint(
      () => client.query(`select public.mark_integration_log_resolved($1)`, [logId]),
      /not authorized/,
    );
    await asSuperuser();

    await asUser(adminAId);
    const result = await client.query(
      `select (public.mark_integration_log_resolved($1)).status as status`,
      [logId],
    );
    expect(result.rows[0].status).toBe("resolved");
  });

  it("external_record_links prevents a second CRM contact link for the same lead+connection", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);
    await client.query(
      `insert into public.external_record_links (organization_id, integration_connection_id, lead_id, provider, external_record_id)
       values ($1, $2, $3, 'generic_http', 'ext-1')`,
      [orgAId, connectionId, leadId],
    );

    await expect(
      client.query(
        `insert into public.external_record_links (organization_id, integration_connection_id, lead_id, provider, external_record_id)
         values ($1, $2, $3, 'generic_http', 'ext-2')`,
        [orgAId, connectionId, leadId],
      ),
    ).rejects.toThrow(/external_record_links_connection_lead_unique/);
  });

  it("apply_inbound_crm_status_change applies a mapped status and is idempotent on repeat calls", async () => {
    const leadId = nextLeadId();
    await insertLead(leadId);
    await client.query(
      `update public.integration_connections set settings = $2 where id = $1`,
      [connectionId, JSON.stringify({ statusMapping: { crm_won: "converted" } })],
    );
    await client.query(
      `insert into public.external_record_links (organization_id, integration_connection_id, lead_id, provider, external_record_id)
       values ($1, $2, $3, 'generic_http', 'inbound-ext-1')`,
      [orgAId, connectionId, leadId],
    );

    const first = await client.query(
      `select public.apply_inbound_crm_status_change($1, 'inbound-ext-1', 'crm_won') as result`,
      [connectionId],
    );
    expect(first.rows[0].result.applied).toBe(true);

    const lead = await client.query(
      `select lead_status from public.leads where id = $1`,
      [leadId],
    );
    expect(lead.rows[0].lead_status).toBe("converted");

    const second = await client.query(
      `select public.apply_inbound_crm_status_change($1, 'inbound-ext-1', 'crm_won') as result`,
      [connectionId],
    );
    expect(second.rows[0].result.reason).toBe("no_op");

    const historyCount = await client.query(
      `select count(*)::int as n from public.lead_status_history where lead_id = $1`,
      [leadId],
    );
    expect(historyCount.rows[0].n).toBe(1);
  });

  it("cross-organization access: an org_admin cannot read another organization's integration connections, logs, or webhook endpoints", async () => {
    await client.query(
      `insert into public.webhook_endpoints (organization_id, url, secret_encrypted, subscribed_events)
       values ($1, 'https://example.test/hooks', 'deadbeef', array['lead.created']::text[])`,
      [orgAId],
    );

    await asUser(adminBId);

    const connections = await client.query(
      `select id from public.integration_connections where organization_id = $1`,
      [orgAId],
    );
    expect(connections.rows).toEqual([]);

    const endpoints = await client.query(
      `select id from public.webhook_endpoints where organization_id = $1`,
      [orgAId],
    );
    expect(endpoints.rows).toEqual([]);
  });
});
