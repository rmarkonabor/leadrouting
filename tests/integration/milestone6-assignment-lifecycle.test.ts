import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres tests for Milestone 6 (notifications, integration_jobs,
 * viewed tracking, expiration/reassignment Cron sweeps, manual assignment).
 * See tests/integration/README.md — skipped automatically without
 * TEST_DATABASE_URL. Covers the 15 required scenarios from the kickoff:
 * acceptance, decline, expiration, reassignment, previous-recipient
 * exclusion, repeated accept requests, accept/decline after expiration, two
 * simultaneous accept requests, no eligible replacement, manual assignment,
 * cross-org access, plus notification enqueue idempotency (repeated job
 * delivery / queue retry behavior are covered at the unit level in
 * tests/unit/notifications since they concern the TypeScript consumer, not
 * SQL — see that file for the Sentry-sanitization scenario too).
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 6 assignment lifecycle", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000501";
  const orgBId = "00000000-0000-4000-8000-000000000502";
  const adminAId = "00000000-0000-4000-8000-0000000009a1";
  const adminBId = "00000000-0000-4000-8000-0000000009b1";
  const agent1Id = "00000000-0000-4000-8000-0000000009a2";
  const agent2Id = "00000000-0000-4000-8000-0000000009a3";
  const teamId = "00000000-0000-4000-8000-000000000a01";
  const sourceId = "00000000-0000-4000-8000-000000000b01";
  const flowId = "00000000-0000-4000-8000-000000000c01";
  const ruleId = "00000000-0000-4000-8000-000000000d01";

  const allDayWorkingHours = JSON.stringify(
    Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
        (d) => [d, { start: "00:00", end: "23:59" }],
      ),
    ),
  );

  let leadCounter = 0;
  function nextLeadId(): string {
    leadCounter++;
    return `00000000-0000-4000-8000-0000000${(60000 + leadCounter).toString().padStart(5, "0")}`;
  }

  async function routeAndGetAssignment(leadId: string, email: string) {
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, email, sourceId],
    );
    const result = await client.query(`select public.route_lead($1) as result`, [leadId]);
    return result.rows[0].result;
  }

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-m6@example.test"],
      [adminBId, "admin-b-m6@example.test"],
      [agent1Id, "agent1-m6@example.test"],
      [agent2Id, "agent2-m6@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm6-org-a'), ($2, 'Org B', 'm6-org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );

    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values
       ($1, $2, 'org_admin', 'active'), ($1, $3, 'agent', 'active'), ($1, $4, 'agent', 'active'),
       ($5, $6, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, adminAId, agent1Id, agent2Id, orgBId, adminBId],
    );

    await client.query(
      `insert into public.user_availability (organization_id, user_id, availability_status) values
       ($1, $2, 'available'), ($1, $3, 'available') on conflict (organization_id, user_id) do nothing`,
      [orgAId, agent1Id, agent2Id],
    );

    await client.query(
      `insert into public.user_assignment_settings
         (organization_id, user_id, accept_leads, timezone, working_hours, daily_lead_limit, active_lead_limit, assignment_weight)
       values
         ($1, $2, true, 'UTC', $3::jsonb, 0, 0, 1), ($1, $4, true, 'UTC', $3::jsonb, 0, 0, 1)
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, agent1Id, allDayWorkingHours, agent2Id],
    );

    await client.query(
      `insert into public.teams (id, organization_id, name) values ($1, $2, 'Team') on conflict (id) do nothing`,
      [teamId, orgAId],
    );
    await client.query(
      `insert into public.team_users (organization_id, team_id, user_id, is_manager, created_at) values
       ($1, $2, $3, false, now() - interval '2 hour'), ($1, $2, $4, false, now() - interval '1 hour')
       on conflict (team_id, user_id) do nothing`,
      [orgAId, teamId, agent1Id, agent2Id],
    );

    await client.query(
      `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
       values ($1, $2, 'src', 'api', 'm6-hash') on conflict (id) do nothing`,
      [sourceId, orgAId],
    );

    await client.query(
      `insert into public.routing_flows (id, organization_id, name, status, acceptance_deadline_minutes)
       values ($1, $2, 'Flow', 'draft', 30) on conflict (id) do nothing`,
      [flowId, orgAId],
    );
    await client.query(
      `insert into public.routing_rules (id, organization_id, routing_flow_id, name, priority, match_type, conditions, action)
       values ($1, $2, $3, 'RR', 100, 'match_all', '[]'::jsonb, jsonb_build_object('type','round_robin','teamId',$4::uuid))
       on conflict (id) do nothing`,
      [ruleId, orgAId, flowId, teamId],
    );

    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)`,
      [adminAId],
    );
    await client.query(`select public.publish_routing_flow($1)`, [flowId]);
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
  });

  it("1. acceptance: accept_assignment moves a pending assignment to accepted and records an activity", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-accept@x.test");
    const assignmentId = routed.assignment.id;

    await client.query(`select public.accept_assignment($1)`, [assignmentId]);

    const row = await client.query(
      `select status from public.assignments where id = $1`,
      [assignmentId],
    );
    expect(row.rows[0].status).toBe("accepted");

    const activity = await client.query(
      `select 1 from public.activities where lead_id = $1 and activity_type = 'assignment_accepted'`,
      [leadId],
    );
    expect(activity.rows).toHaveLength(1);
  });

  it("2. decline: decline_assignment moves to declined and triggers reassignment", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-decline@x.test");
    const firstAssignmentId = routed.assignment.id;
    const firstUserId = routed.assignment.user_id;

    await client.query(`select public.decline_assignment($1)`, [firstAssignmentId]);

    const rows = await client.query(
      `select user_id, status from public.assignments where lead_id = $1 order by created_at`,
      [leadId],
    );
    expect(rows.rows[0]).toMatchObject({ user_id: firstUserId, status: "declined" });
    expect(rows.rows[1]).toMatchObject({ status: "pending" });
    expect(rows.rows[1].user_id).not.toBe(firstUserId);
  });

  it("3. expiration: run_expire_assignments expires overdue assignments and is idempotent", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-expire@x.test");
    await client.query(
      `update public.assignments set acceptance_deadline_at = now() - interval '1 minute' where id = $1`,
      [routed.assignment.id],
    );

    const first = await client.query(`select public.run_expire_assignments() as n`);
    const second = await client.query(`select public.run_expire_assignments() as n`);

    expect(first.rows[0].n).toBeGreaterThanOrEqual(1);
    expect(second.rows[0].n).toBe(0);

    const row = await client.query(
      `select status from public.assignments where id = $1`,
      [routed.assignment.id],
    );
    expect(row.rows[0].status).toBe("expired");
  });

  it("4. automatic reassignment: expiring an assignment creates a new pending assignment for a different user", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-reassign@x.test");
    await client.query(
      `update public.assignments set acceptance_deadline_at = now() - interval '1 minute' where id = $1`,
      [routed.assignment.id],
    );
    await client.query(`select public.run_expire_assignments()`);

    const rows = await client.query(
      `select user_id, status from public.assignments where lead_id = $1 order by created_at`,
      [leadId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].status).toBe("expired");
    expect(rows.rows[1].status).toBe("pending");
    expect(rows.rows[1].user_id).not.toBe(rows.rows[0].user_id);
  });

  it("5. previous recipient exclusion: declining through both agents lands the lead in manual review", async () => {
    const leadId = nextLeadId();
    const first = await routeAndGetAssignment(leadId, "l-exhaust@x.test");
    await client.query(`select public.decline_assignment($1)`, [first.assignment.id]);

    const second = await client.query(
      `select id from public.assignments where lead_id = $1 and status = 'pending'`,
      [leadId],
    );
    expect(second.rows).toHaveLength(1);
    await client.query(`select public.decline_assignment($1)`, [second.rows[0].id]);

    const lead = await client.query(
      `select assignment_status from public.leads where id = $1`,
      [leadId],
    );
    expect(lead.rows[0].assignment_status).toBe("manual_review");

    const review = await client.query(
      `select reason from public.manual_review_items where lead_id = $1`,
      [leadId],
    );
    expect(review.rows).toHaveLength(1);
  });

  it("6. no eligible replacement: same exhaustion scenario produces exactly one manual_review_items row, no pending assignment left", async () => {
    const leadId = nextLeadId();
    const first = await routeAndGetAssignment(leadId, "l-noeligible@x.test");
    await client.query(`select public.decline_assignment($1)`, [first.assignment.id]);
    const second = await client.query(
      `select id from public.assignments where lead_id = $1 and status = 'pending'`,
      [leadId],
    );
    await client.query(`select public.decline_assignment($1)`, [second.rows[0].id]);

    const pending = await client.query(
      `select count(*)::int as n from public.assignments where lead_id = $1 and status in ('pending','notified','viewed')`,
      [leadId],
    );
    expect(pending.rows[0].n).toBe(0);
  });

  it("7. repeated accept requests are idempotent", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-repeat-accept@x.test");
    const assignmentId = routed.assignment.id;

    await client.query(`select public.accept_assignment($1)`, [assignmentId]);
    await expect(
      client.query(`select public.accept_assignment($1)`, [assignmentId]),
    ).resolves.toBeDefined();

    const row = await client.query(
      `select status from public.assignments where id = $1`,
      [assignmentId],
    );
    expect(row.rows[0].status).toBe("accepted");
  });

  it("8. accept after expiration is rejected", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-accept-after-expire@x.test");
    await client.query(
      `update public.assignments set acceptance_deadline_at = now() - interval '1 minute' where id = $1`,
      [routed.assignment.id],
    );
    await client.query(`select public.run_expire_assignments()`);

    await expect(
      client.query(`select public.accept_assignment($1)`, [routed.assignment.id]),
    ).rejects.toThrow(/cannot be accepted/);
  });

  it("9. decline after expiration is rejected", async () => {
    const leadId = nextLeadId();
    const routed = await routeAndGetAssignment(leadId, "l-decline-after-expire@x.test");
    await client.query(
      `update public.assignments set acceptance_deadline_at = now() - interval '1 minute' where id = $1`,
      [routed.assignment.id],
    );
    await client.query(`select public.run_expire_assignments()`);

    await expect(
      client.query(`select public.decline_assignment($1)`, [routed.assignment.id]),
    ).rejects.toThrow(/cannot be declined/);
  });

  it("10. two simultaneous accept requests on the same assignment do not both succeed with conflicting state", async () => {
    // Genuine cross-connection concurrency requires the fixture rows to be
    // committed and visible to a second, independent Postgres session — the
    // rest of this file deliberately keeps everything inside one uncommitted
    // transaction (rolled back in afterAll) for isolation, which a second
    // connection can never see. This one test manages its own committed,
    // self-cleaning fixture instead of using the shared `client`/beforeAll
    // state, exactly for that reason.
    const setupClient = new Client({ connectionString: TEST_DATABASE_URL });
    const raceClient = new Client({ connectionString: TEST_DATABASE_URL });
    await setupClient.connect();
    await raceClient.connect();
    const raceOrgId = "00000000-0000-4000-8000-000000000f01";
    const raceSourceId = "00000000-0000-4000-8000-000000000f02";
    const leadId = "00000000-0000-4000-8000-000000000f03";
    const assignmentId = "00000000-0000-4000-8000-000000000f04";
    const raceUserId = "00000000-0000-4000-8000-000000000f05";

    try {
      await setupClient.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, 'race-agent-m6@example.test', 'x', now(), 'authenticated', 'authenticated')`,
        [raceUserId],
      );
      await setupClient.query(
        `insert into public.organizations (id, name, slug) values ($1, 'Race Org', 'm6-race-org')`,
        [raceOrgId],
      );
      await setupClient.query(
        `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
         values ($1, $2, 'src', 'api', 'm6-race-hash')`,
        [raceSourceId, raceOrgId],
      );
      await setupClient.query(
        `insert into public.organization_users (organization_id, user_id, role, status) values ($1, $2, 'agent', 'active')`,
        [raceOrgId, raceUserId],
      );
      await setupClient.query(
        `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
        [leadId, raceOrgId, "l-concurrent-accept@x.test", raceSourceId],
      );
      await setupClient.query(
        `insert into public.assignments (id, organization_id, lead_id, user_id, status, assignment_algorithm, acceptance_deadline_at)
         values ($1, $2, $3, $4, 'pending', 'direct', now() + interval '30 minutes')`,
        [assignmentId, raceOrgId, leadId, raceUserId],
      );

      const [a, b] = await Promise.all([
        setupClient.query(`select to_jsonb(public.accept_assignment($1)) as a`, [
          assignmentId,
        ]),
        raceClient.query(`select to_jsonb(public.accept_assignment($1)) as a`, [
          assignmentId,
        ]),
      ]);
      expect(a.rows[0].a.status).toBe("accepted");
      expect(b.rows[0].a.status).toBe("accepted");

      const row = await setupClient.query(
        `select status from public.assignments where id = $1`,
        [assignmentId],
      );
      expect(row.rows[0].status).toBe("accepted");
    } finally {
      await setupClient.query(`delete from public.organizations where id = $1`, [
        raceOrgId,
      ]);
      await setupClient.query(`delete from auth.users where id = $1`, [raceUserId]);
      await setupClient.end();
      await raceClient.end();
    }
  });

  it("11. manual assignment: an org_admin can directly assign a lead without routing", async () => {
    const leadId = nextLeadId();
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, "l-manual@x.test", sourceId],
    );

    const result = await client.query(
      `select to_jsonb(public.manually_assign_lead($1, $2, $3)) as a`,
      [leadId, agent1Id, teamId],
    );
    expect(result.rows[0].a.status).toBe("pending");
    expect(result.rows[0].a.user_id).toBe(agent1Id);
    expect(result.rows[0].a.assignment_algorithm).toBe("manual");

    const lead = await client.query(
      `select assignment_status, assigned_user_id from public.leads where id = $1`,
      [leadId],
    );
    expect(lead.rows[0]).toMatchObject({
      assignment_status: "assigned",
      assigned_user_id: agent1Id,
    });

    const activity = await client.query(
      `select 1 from public.activities where lead_id = $1 and activity_type = 'manual_assignment'`,
      [leadId],
    );
    expect(activity.rows).toHaveLength(1);
  });

  it("11a. manual assignment rejects a user_id that is not an active member of the lead's organization (production readiness audit finding)", async () => {
    const leadId = nextLeadId();
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, "l-manual-foreign-user@x.test", sourceId],
    );

    // adminBId is a real user, but only a member of orgB — orgA's own
    // admin (the caller here, per the still-active jwt claims set in
    // beforeAll) must not be able to assign an orgA lead to them.
    await expect(
      client.query(`select public.manually_assign_lead($1, $2, $3)`, [
        leadId,
        adminBId,
        teamId,
      ]),
    ).rejects.toThrow(/not an active member/);
  });

  it("11b. manual assignment rejects a user_id that does not exist at all", async () => {
    const leadId = nextLeadId();
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, "l-manual-nonexistent-user@x.test", sourceId],
    );

    await expect(
      client.query(`select public.manually_assign_lead($1, $2, $3)`, [
        leadId,
        "00000000-0000-4000-8000-00000000dead",
        teamId,
      ]),
    ).rejects.toThrow(/not an active member/);
  });

  it("11c. manual assignment rejects a team_id that belongs to a different organization", async () => {
    const leadId = nextLeadId();
    const foreignTeamId = "00000000-0000-4000-8000-000000000b02";
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', $3, $4)`,
      [leadId, orgAId, "l-manual-foreign-team@x.test", sourceId],
    );
    await client.query(
      `insert into public.teams (id, organization_id, name) values ($1, $2, 'Org B Team')`,
      [foreignTeamId, orgBId],
    );

    await expect(
      client.query(`select public.manually_assign_lead($1, $2, $3)`, [
        leadId,
        agent1Id,
        foreignTeamId,
      ]),
    ).rejects.toThrow(/does not belong to this organization/);
  });

  it("12. cross-organization access: an org_admin cannot read another organization's notifications or integration_jobs", async () => {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)`,
      [adminBId],
    );

    const notifications = await client.query(
      `select id from public.notifications where organization_id = $1`,
      [orgAId],
    );
    expect(notifications.rows).toEqual([]);

    const jobs = await client.query(
      `select id from public.integration_jobs where organization_id = $1`,
      [orgAId],
    );
    expect(jobs.rows).toEqual([]);

    await client.query("reset role");
  });

  it("enqueue_assignment_notification is idempotent: the same dedupe key never creates two jobs", async () => {
    const first = await client.query(
      `select public.enqueue_assignment_notification($1, 'new_lead_assignment', 'dedupe-test-1', '{}'::jsonb) as id`,
      [orgAId],
    );
    const second = await client.query(
      `select public.enqueue_assignment_notification($1, 'new_lead_assignment', 'dedupe-test-1', '{}'::jsonb) as id`,
      [orgAId],
    );

    expect(first.rows[0].id).not.toBeNull();
    expect(second.rows[0].id).toBeNull();

    const count = await client.query(
      `select count(*)::int as n from public.integration_jobs where dedupe_key = 'dedupe-test-1'`,
    );
    expect(count.rows[0].n).toBe(1);
  });
});
