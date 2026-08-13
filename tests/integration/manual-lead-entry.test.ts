import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres tests for `create_manual_lead`
 * (`supabase/migrations/20260813120000_manual_lead_entry_routes_immediately.sql`).
 * See tests/integration/README.md for how to run these — skipped
 * automatically without TEST_DATABASE_URL.
 *
 * Covers the two things that migration exists to fix: (1) a manually
 * created lead is actually routed, not left permanently unassigned, and
 * (2) the function independently re-checks organization membership rather
 * than trusting a client-passed p_organization_id, mirroring the fix in
 * 20260813100000_validate_manual_assignment_org_membership.sql for the
 * same class of cross-tenant gap.
 */
describe.skipIf(!TEST_DATABASE_URL)("create_manual_lead", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000d01";
  const orgBId = "00000000-0000-4000-8000-000000000d02";
  const adminAId = "00000000-0000-4000-8000-0000000007d1";
  const adminBId = "00000000-0000-4000-8000-0000000007d2";
  const agentId = "00000000-0000-4000-8000-0000000007d3";
  const teamManagerId = "00000000-0000-4000-8000-0000000007d4";
  const teamId = "00000000-0000-4000-8000-000000000801";
  const flowId = "00000000-0000-4000-8000-000000000e01";
  const ruleId = "00000000-0000-4000-8000-000000000f01";

  const allDayWorkingHours = JSON.stringify(
    Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
        (d) => [d, { start: "00:00", end: "23:59" }],
      ),
    ),
  );

  async function callAs(userId: string) {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, true)`,
      [userId],
    );
  }

  async function resetCaller() {
    await client.query("reset role");
  }

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-manual@example.test"],
      [adminBId, "admin-b-manual@example.test"],
      [agentId, "agent-manual@example.test"],
      [teamManagerId, "team-manager-manual@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'manual-org-a'), ($2, 'Org B', 'manual-org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );

    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values
       ($1, $2, 'org_admin', 'active'), ($1, $3, 'agent', 'active'), ($1, $4, 'agent', 'active'),
       ($5, $6, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, adminAId, agentId, teamManagerId, orgBId, adminBId],
    );

    await client.query(
      `insert into public.user_availability (organization_id, user_id, availability_status) values
       ($1, $2, 'available') on conflict (organization_id, user_id) do nothing`,
      [orgAId, teamManagerId],
    );

    await client.query(
      `insert into public.user_assignment_settings
         (organization_id, user_id, accept_leads, timezone, working_hours, daily_lead_limit, active_lead_limit, assignment_weight)
       values ($1, $2, true, 'UTC', $3::jsonb, 0, 0, 1)
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, teamManagerId, allDayWorkingHours],
    );

    await client.query(
      `insert into public.teams (id, organization_id, name) values ($1, $2, 'Team') on conflict (id) do nothing`,
      [teamId, orgAId],
    );
    await client.query(
      `insert into public.team_users (organization_id, team_id, user_id, is_manager) values ($1, $2, $3, true)
       on conflict (team_id, user_id) do nothing`,
      [orgAId, teamId, teamManagerId],
    );

    await client.query(
      `insert into public.routing_flows (id, organization_id, name, status) values ($1, $2, 'Flow', 'draft')
       on conflict (id) do nothing`,
      [flowId, orgAId],
    );
    await client.query(
      `insert into public.routing_rules (id, organization_id, routing_flow_id, name, priority, match_type, conditions, action)
       values ($1, $2, $3, 'Direct', 100, 'match_all', '[]'::jsonb, jsonb_build_object('type','round_robin','teamId',$4::uuid))
       on conflict (id) do nothing`,
      [ruleId, orgAId, flowId, teamId],
    );

    await callAs(adminAId);
    await client.query(`select public.publish_routing_flow($1)`, [flowId]);
    await resetCaller();
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  beforeEach(async () => {
    await client.query("savepoint test_savepoint");
  });

  afterEach(async () => {
    await resetCaller();
    await client.query("rollback to savepoint test_savepoint");
  });

  it("org_admin creates a lead that is routed immediately, not left unassigned", async () => {
    await callAs(adminAId);

    const result = await client.query(
      `select public.create_manual_lead($1,'Jane','Doe','jane@x.test',null,null,null,null,null,null,null,null,null,null) as result`,
      [orgAId],
    );
    const leadId = result.rows[0].result.leadId;
    const routing = result.rows[0].result.routing;

    expect(routing.outcome).toBe("assigned");

    const lead = await client.query(
      `select assignment_status, assigned_user_id from public.leads where id = $1`,
      [leadId],
    );
    expect(lead.rows[0].assignment_status).toBe("assigned");
    expect(lead.rows[0].assigned_user_id).toBe(teamManagerId);
  });

  it("a permitted team_manager may also create and route a manual lead", async () => {
    await callAs(teamManagerId);

    const result = await client.query(
      `select public.create_manual_lead($1,'Jane','Doe','jane2@x.test',null,null,null,null,null,null,null,null,null,null) as result`,
      [orgAId],
    );
    expect(result.rows[0].result.routing.outcome).toBe("assigned");
  });

  it("a plain agent cannot create a manual lead", async () => {
    await callAs(agentId);

    await expect(
      client.query(
        `select public.create_manual_lead($1,'Jane','Doe','jane3@x.test',null,null,null,null,null,null,null,null,null,null) as result`,
        [orgAId],
      ),
    ).rejects.toThrow(/not permitted/);
  });

  it("an org_admin of a different organization cannot create a lead in this one by passing its organization_id directly", async () => {
    await callAs(adminBId);

    await expect(
      client.query(
        `select public.create_manual_lead($1,'Jane','Doe','jane4@x.test',null,null,null,null,null,null,null,null,null,null) as result`,
        [orgAId],
      ),
    ).rejects.toThrow(/not permitted/);
  });
});
