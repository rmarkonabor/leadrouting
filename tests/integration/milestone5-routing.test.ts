import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres tests for Milestone 5 (routing_flows, routing_rules,
 * assignments, routing_state, manual_review_items). See
 * tests/integration/README.md for how to run these — skipped automatically
 * without TEST_DATABASE_URL.
 *
 * These scenarios were manually verified during development against a real
 * local Postgres 16 instance (not just Supabase) before this migration was
 * shipped — see docs/decisions.md for a summary of what was verified and
 * how, since this sandboxed session has no TEST_DATABASE_URL of its own.
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 5 routing engine", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000401";
  const orgBId = "00000000-0000-4000-8000-000000000402";
  const adminAId = "00000000-0000-4000-8000-0000000007a1";
  const adminBId = "00000000-0000-4000-8000-0000000007b1";
  const agent1Id = "00000000-0000-4000-8000-0000000007a2";
  const agent2Id = "00000000-0000-4000-8000-0000000007a3";
  const teamId = "00000000-0000-4000-8000-000000000801";
  const sourceId = "00000000-0000-4000-8000-000000000901";
  const flowId = "00000000-0000-4000-8000-000000000a01";
  const ruleId = "00000000-0000-4000-8000-000000000b01";

  const allDayWorkingHours = JSON.stringify(
    Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
        (d) => [d, { start: "00:00", end: "23:59" }],
      ),
    ),
  );

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-m5@example.test"],
      [adminBId, "admin-b-m5@example.test"],
      [agent1Id, "agent1-m5@example.test"],
      [agent2Id, "agent2-m5@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm5-org-a'), ($2, 'Org B', 'm5-org-b')
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
       values ($1, $2, 'src', 'api', 'm5-hash') on conflict (id) do nothing`,
      [sourceId, orgAId],
    );

    await client.query(
      `insert into public.routing_flows (id, organization_id, name, status) values ($1, $2, 'Flow', 'draft')
       on conflict (id) do nothing`,
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

  // Isolates each test (including the deliberate immutability-violation
  // error below) from the others — see tests/integration/milestone2-rls.test.ts.
  beforeEach(async () => {
    await client.query("savepoint test_savepoint");
  });

  afterEach(async () => {
    await client.query("rollback to savepoint test_savepoint");
  });

  it("routes a lead via round robin and creates exactly one active assignment", async () => {
    const leadId = "00000000-0000-4000-8000-000000000c01";
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', 'l1@x.test', $3)`,
      [leadId, orgAId, sourceId],
    );

    const result = await client.query(`select public.route_lead($1) as result`, [leadId]);
    expect(result.rows[0].result.outcome).toBe("assigned");

    const count = await client.query(
      `select count(*)::int as n from public.assignments where lead_id = $1 and status in ('pending','notified','viewed')`,
      [leadId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("is idempotent: routing the same lead again returns the existing assignment, not a new one", async () => {
    const leadId = "00000000-0000-4000-8000-000000000c02";
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', 'l2@x.test', $3)`,
      [leadId, orgAId, sourceId],
    );

    const first = await client.query(`select public.route_lead($1) as result`, [leadId]);
    const second = await client.query(`select public.route_lead($1) as result`, [leadId]);

    expect(first.rows[0].result.outcome).toBe("assigned");
    expect(second.rows[0].result.outcome).toBe("already_assigned");

    const count = await client.query(
      `select count(*)::int as n from public.assignments where lead_id = $1`,
      [leadId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("simulate_routing predicts the outcome without writing anything", async () => {
    const leadId = "00000000-0000-4000-8000-000000000c03";
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', 'l3@x.test', $3)`,
      [leadId, orgAId, sourceId],
    );

    const before = await client.query(
      `select (select count(*) from public.assignments) as assignments,
              (select count(*) from public.activities) as activities,
              (select count(*) from public.manual_review_items) as manual_review,
              (select rotation_cursor from public.routing_state where team_id = $1) as cursor`,
      [teamId],
    );

    const simulated = await client.query(`select public.simulate_routing($1) as result`, [
      leadId,
    ]);
    expect(simulated.rows[0].result.simulated).toBe(true);

    const after = await client.query(
      `select (select count(*) from public.assignments) as assignments,
              (select count(*) from public.activities) as activities,
              (select count(*) from public.manual_review_items) as manual_review,
              (select rotation_cursor from public.routing_state where team_id = $1) as cursor`,
      [teamId],
    );

    expect(after.rows[0]).toEqual(before.rows[0]);

    const leadRow = await client.query(
      `select assigned_user_id from public.leads where id = $1`,
      [leadId],
    );
    expect(leadRow.rows[0].assigned_user_id).toBeNull();
  });

  it("declining an assignment triggers reassignment, excluding the decliner", async () => {
    const leadId = "00000000-0000-4000-8000-000000000c04";
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id) values ($1, $2, 'L', 'l4@x.test', $3)`,
      [leadId, orgAId, sourceId],
    );

    const routed = await client.query(`select public.route_lead($1) as result`, [leadId]);
    const firstAssignmentId = routed.rows[0].result.assignment.id;
    const firstUserId = routed.rows[0].result.assignment.user_id;

    await client.query(`select public.decline_assignment($1)`, [firstAssignmentId]);

    const assignments = await client.query(
      `select user_id, status from public.assignments where lead_id = $1 order by created_at`,
      [leadId],
    );
    expect(assignments.rows[0]).toMatchObject({
      user_id: firstUserId,
      status: "declined",
    });
    expect(assignments.rows[1].user_id).not.toBe(firstUserId);
    expect(assignments.rows[1].status).toBe("pending");
  });

  it("published routing_flow_versions are immutable", async () => {
    const version = await client.query(
      `select id from public.routing_flow_versions where routing_flow_id = $1 limit 1`,
      [flowId],
    );
    await expect(
      client.query(
        `update public.routing_flow_versions set version_number = 99 where id = $1`,
        [version.rows[0].id],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("an org_admin cannot read another organization's routing flows or assignments", async () => {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)`,
      [adminBId],
    );

    const flows = await client.query(
      `select id from public.routing_flows where organization_id = $1`,
      [orgAId],
    );
    expect(flows.rows).toEqual([]);

    const assignments = await client.query(
      `select id from public.assignments where organization_id = $1`,
      [orgAId],
    );
    expect(assignments.rows).toEqual([]);

    await client.query("reset role");
  });
});
