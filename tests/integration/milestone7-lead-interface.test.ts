import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres tests for Milestone 7 (lead_status_definitions/history,
 * notes, routing_health_metrics, the permission rules from the kickoff).
 * See tests/integration/README.md — skipped automatically without
 * TEST_DATABASE_URL.
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 7 lead interface", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000601";
  const orgBId = "00000000-0000-4000-8000-000000000602";
  const adminAId = "00000000-0000-4000-8000-000000000a11";
  const managerAId = "00000000-0000-4000-8000-000000000a12";
  const agent1Id = "00000000-0000-4000-8000-000000000a13";
  const agent2Id = "00000000-0000-4000-8000-000000000a14";
  const sourceId = "00000000-0000-4000-8000-000000000b11";
  const teamId = "00000000-0000-4000-8000-000000000c11";
  const otherTeamId = "00000000-0000-4000-8000-000000000c12";

  let leadCounter = 0;
  function nextLeadId(): string {
    leadCounter++;
    return `00000000-0000-4000-8000-0000001${(10000 + leadCounter).toString().padStart(4, "0")}`;
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

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-m7@example.test"],
      [managerAId, "manager-a-m7@example.test"],
      [agent1Id, "agent1-m7@example.test"],
      [agent2Id, "agent2-m7@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm7-org-a'), ($2, 'Org B', 'm7-org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );

    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values
       ($1, $2, 'org_admin', 'active'), ($1, $3, 'team_manager', 'active'),
       ($1, $4, 'agent', 'active'), ($1, $5, 'agent', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, adminAId, managerAId, agent1Id, agent2Id],
    );

    await client.query(
      `insert into public.teams (id, organization_id, name) values
       ($1, $2, 'Team 1'), ($3, $2, 'Team 2') on conflict (id) do nothing`,
      [teamId, orgAId, otherTeamId],
    );
    await client.query(
      `insert into public.team_users (organization_id, team_id, user_id, is_manager) values
       ($1, $2, $3, true), ($1, $2, $4, false) on conflict (team_id, user_id) do nothing`,
      [orgAId, teamId, managerAId, agent1Id],
    );

    await client.query(
      `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
       values ($1, $2, 'src', 'api', 'm7-hash') on conflict (id) do nothing`,
      [sourceId, orgAId],
    );

    await client.query(`select public.seed_default_lead_statuses($1)`, [orgAId]);
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

  async function insertLead(opts: {
    leadId: string;
    assignedUserId?: string | null;
    assignedTeamId?: string | null;
  }) {
    await client.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id, assigned_user_id, assigned_team_id)
       values ($1, $2, 'L', $3, $4, $5, $6)`,
      [
        opts.leadId,
        orgAId,
        `${opts.leadId}@x.test`,
        sourceId,
        opts.assignedUserId ?? null,
        opts.assignedTeamId ?? null,
      ],
    );
  }

  it("seed_default_lead_statuses seeds the 9 spec defaults for a new org", async () => {
    const result = await client.query(
      `select key from public.lead_status_definitions where organization_id = $1 order by sort_order`,
      [orgAId],
    );
    expect(result.rows.map((r) => r.key)).toEqual([
      "new",
      "assigned",
      "accepted",
      "contact_attempted",
      "contacted",
      "qualified",
      "unqualified",
      "converted",
      "lost",
    ]);
  });

  it("update_lead_status records the correct from/to status and an activity row", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });

    await asUser(adminAId);
    await client.query(`select public.update_lead_status($1, 'contacted')`, [leadId]);

    const history = await client.query(
      `select from_status, to_status from public.lead_status_history where lead_id = $1`,
      [leadId],
    );
    expect(history.rows).toEqual([{ from_status: "new", to_status: "contacted" }]);

    const activity = await client.query(
      `select 1 from public.activities where lead_id = $1 and activity_type = 'status_changed'`,
      [leadId],
    );
    expect(activity.rows).toHaveLength(1);
  });

  it("update_lead_status is a no-op (no new history row) when the status is unchanged", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });

    await asUser(adminAId);
    await client.query(`select public.update_lead_status($1, 'new')`, [leadId]);

    const history = await client.query(
      `select count(*)::int as n from public.lead_status_history where lead_id = $1`,
      [leadId],
    );
    expect(history.rows[0].n).toBe(0);
  });

  it("update_lead_status rejects a status key that doesn't exist for the org", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });

    await asUser(adminAId);
    await expect(
      client.query(`select public.update_lead_status($1, 'not_a_real_status')`, [leadId]),
    ).rejects.toThrow();
  });

  it("add_note inserts a note and a matching activity row atomically", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });

    await asUser(agent1Id);
    await client.query(`select public.add_note($1, $2)`, [
      leadId,
      "Called, left voicemail.",
    ]);

    const note = await client.query(
      `select author_user_id, content from public.notes where lead_id = $1`,
      [leadId],
    );
    expect(note.rows).toEqual([
      { author_user_id: agent1Id, content: "Called, left voicemail." },
    ]);

    const activity = await client.query(
      `select 1 from public.activities where lead_id = $1 and activity_type = 'note_added'`,
      [leadId],
    );
    expect(activity.rows).toHaveLength(1);
  });

  it("an agent cannot add a note to a lead assigned to someone else", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent2Id });

    await asUser(agent1Id);
    await expect(
      client.query(`select public.add_note($1, $2)`, [leadId, "Should not be allowed."]),
    ).rejects.toThrow();
  });

  it("permission rules: an agent sees only their own assigned leads", async () => {
    const ownLeadId = nextLeadId();
    const otherLeadId = nextLeadId();
    await insertLead({ leadId: ownLeadId, assignedUserId: agent1Id });
    await insertLead({ leadId: otherLeadId, assignedUserId: agent2Id });

    await asUser(agent1Id);
    const rows = await client.query(
      `select id from public.leads where organization_id = $1 order by id`,
      [orgAId],
    );
    expect(rows.rows.map((r) => r.id)).toEqual([ownLeadId]);
  });

  it("permission rules: a team_manager sees leads assigned to their permitted team but not other teams", async () => {
    const teamLeadId = nextLeadId();
    const otherTeamLeadId = nextLeadId();
    await insertLead({ leadId: teamLeadId, assignedTeamId: teamId });
    await insertLead({ leadId: otherTeamLeadId, assignedTeamId: otherTeamId });

    await asUser(managerAId);
    const rows = await client.query(
      `select id from public.leads where organization_id = $1 order by id`,
      [orgAId],
    );
    expect(rows.rows.map((r) => r.id)).toEqual([teamLeadId]);
  });

  it("permission rules: an org_admin sees every lead in the organization", async () => {
    const leadId1 = nextLeadId();
    const leadId2 = nextLeadId();
    await insertLead({ leadId: leadId1, assignedUserId: agent1Id });
    await insertLead({ leadId: leadId2, assignedTeamId: otherTeamId });

    await asUser(adminAId);
    const rows = await client.query(
      `select id from public.leads where organization_id = $1 and id = any($2)`,
      [orgAId, [leadId1, leadId2]],
    );
    expect(rows.rows).toHaveLength(2);
  });

  it("permission rules: no role can read another organization's leads", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });

    await asUser(adminAId);
    const rows = await client.query(
      `select id from public.leads where organization_id = $1`,
      [orgBId],
    );
    expect(rows.rows).toEqual([]);
  });

  it("compute_routing_health reports leadsReceived and leadsInManualReview accurately for a window", async () => {
    const leadId = nextLeadId();
    await insertLead({ leadId, assignedUserId: agent1Id });
    await client.query(
      `insert into public.manual_review_items (organization_id, lead_id, reason, status)
       values ($1, $2, 'no_eligible_user', 'open')`,
      [orgAId, leadId],
    );

    const bucketStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const bucketEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const result = await client.query(
      `select public.compute_routing_health($1, $2, $3) as metrics`,
      [orgAId, bucketStart, bucketEnd],
    );
    const metrics = result.rows[0].metrics;

    expect(metrics.leadsReceived).toBeGreaterThanOrEqual(1);
    expect(metrics.leadsInManualReview).toBeGreaterThanOrEqual(1);
  });
});
