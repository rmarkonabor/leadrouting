import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Milestone 9 concurrency review: re-runs the release-blocking routing
 * scenarios from docs/phase1-product-spec.md §54 at higher parallelism than
 * the original Milestone 5 verification (ADR-038: 30 leads / 3 agents).
 * Unlike the Milestone 5 integration tests, which share one connection and
 * one uncommitted transaction with savepoints (fine for sequential
 * assertions, useless for real concurrency), every test here opens its own
 * pool of real Postgres connections issuing genuinely simultaneous
 * `route_lead`/`simulate_routing` calls, and uses its own committed,
 * self-cleaning fixture (the same pattern as the M6 "two simultaneous
 * accept requests" test, since a second connection cannot see another
 * connection's uncommitted rows).
 *
 * Per the standing project rule "do not continue when concurrency tests
 * fail — routing concurrency failures are release blocking," any failure
 * here must be root-caused and fixed, never weakened or skipped.
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 9 concurrency review", () => {
  const setupClient = new Client({ connectionString: TEST_DATABASE_URL });

  const orgId = "00000000-0000-4000-8000-000000000f10";
  const sourceId = "00000000-0000-4000-8000-000000000f11";
  const teamId = "00000000-0000-4000-8000-000000000f12";
  const flowId = "00000000-0000-4000-8000-000000000f13";
  const ruleId = "00000000-0000-4000-8000-000000000f14";
  const adminId = "00000000-0000-4000-8000-000000000f15";

  const AGENT_COUNT = 5;
  const LEADS_PER_AGENT = 12;
  const agentIds = Array.from(
    { length: AGENT_COUNT },
    (_, i) => `00000000-0000-4000-8000-00000000f2${i.toString().padStart(2, "0")}`,
  );

  const allDayWorkingHours = JSON.stringify(
    Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(
        (d) => [d, { start: "00:00", end: "23:59" }],
      ),
    ),
  );

  async function connectedClient(): Promise<Client> {
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    return c;
  }

  beforeAll(async () => {
    await setupClient.connect();

    await setupClient.query(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
       values ($1, 'admin-m9-concurrency@example.test', 'x', now(), 'authenticated', 'authenticated')
       on conflict (id) do nothing`,
      [adminId],
    );
    for (const id of agentIds) {
      await setupClient.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated') on conflict (id) do nothing`,
        [id, `${id}@example.test`],
      );
    }

    await setupClient.query(
      `insert into public.organizations (id, name, slug) values ($1, 'M9 Concurrency Org', 'm9-concurrency-org')
       on conflict (id) do nothing`,
      [orgId],
    );
    await setupClient.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values ($1, $2, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgId, adminId],
    );
    for (const id of agentIds) {
      await setupClient.query(
        `insert into public.organization_users (organization_id, user_id, role, status) values ($1, $2, 'agent', 'active')
         on conflict (organization_id, user_id) do nothing`,
        [orgId, id],
      );
      await setupClient.query(
        `insert into public.user_availability (organization_id, user_id, availability_status) values ($1, $2, 'available')
         on conflict (organization_id, user_id) do nothing`,
        [orgId, id],
      );
      await setupClient.query(
        `insert into public.user_assignment_settings
           (organization_id, user_id, accept_leads, timezone, working_hours, daily_lead_limit, active_lead_limit, assignment_weight)
         values ($1, $2, true, 'UTC', $3::jsonb, 0, 0, 1)
         on conflict (organization_id, user_id) do nothing`,
        [orgId, id, allDayWorkingHours],
      );
    }

    await setupClient.query(
      `insert into public.teams (id, organization_id, name) values ($1, $2, 'Concurrency Team')
       on conflict (id) do nothing`,
      [teamId, orgId],
    );
    for (const [i, id] of agentIds.entries()) {
      await setupClient.query(
        `insert into public.team_users (organization_id, team_id, user_id, is_manager, created_at)
         values ($1, $2, $3, false, now() - ($4 || ' hour')::interval)
         on conflict (team_id, user_id) do nothing`,
        [orgId, teamId, id, agentIds.length - i],
      );
    }

    await setupClient.query(
      `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
       values ($1, $2, 'src', 'api', 'm9-concurrency-hash')
       on conflict (id) do nothing`,
      [sourceId, orgId],
    );
    await setupClient.query(
      `insert into public.routing_flows (id, organization_id, name, status) values ($1, $2, 'Concurrency Flow', 'draft')
       on conflict (id) do nothing`,
      [flowId, orgId],
    );
    await setupClient.query(
      `insert into public.routing_rules (id, organization_id, routing_flow_id, name, priority, match_type, conditions, action)
       values ($1, $2, $3, 'RR', 100, 'match_all', '[]'::jsonb, jsonb_build_object('type','round_robin','teamId',$4::uuid))
       on conflict (id) do nothing`,
      [ruleId, orgId, flowId, teamId],
    );
    // is_local = false: setupClient runs in autocommit (no explicit
    // transaction wrapping these statements, unlike the M5 tests), so a
    // local-only config value would be discarded before the next statement.
    await setupClient.query(
      `select set_config('request.jwt.claims', json_build_object('sub',$1::text)::text, false)`,
      [adminId],
    );
    const { rows: existingFlow } = await setupClient.query(
      `select status from public.routing_flows where id = $1`,
      [flowId],
    );
    if (existingFlow[0]?.status !== "active") {
      await setupClient.query(`select public.publish_routing_flow($1)`, [flowId]);
    }
  });

  afterAll(async () => {
    // Committed fixture (real concurrency needs real, cross-connection-
    // visible commits) — clean up explicitly rather than rolling back.
    // routing_flow_versions/routing_rule_versions are immutable by design
    // (no update or delete trigger allows it — see docs/decisions.md
    // ADR-038/ADR on immutable versioning), and published_by_user_id has no
    // ON DELETE clause, so the published flow/rule/version rows and the
    // admin user that published them are intentionally left in place, the
    // same way they would be in production. Only genuinely mutable,
    // this-test-run-only rows are cleaned up.
    await setupClient.query(`delete from public.assignments where organization_id = $1`, [
      orgId,
    ]);
    await setupClient.query(`delete from public.activities where organization_id = $1`, [
      orgId,
    ]);
    await setupClient.query(
      `delete from public.manual_review_items where organization_id = $1`,
      [orgId],
    );
    await setupClient.query(`delete from public.leads where organization_id = $1`, [
      orgId,
    ]);
    await setupClient.query(
      `delete from public.routing_state where organization_id = $1`,
      [orgId],
    );
    await setupClient.query(`delete from public.team_users where organization_id = $1`, [
      orgId,
    ]);
    await setupClient.query(`delete from public.teams where organization_id = $1`, [
      orgId,
    ]);
    await setupClient.query(
      `delete from public.user_assignment_settings where organization_id = $1`,
      [orgId],
    );
    await setupClient.query(
      `delete from public.user_availability where organization_id = $1`,
      [orgId],
    );
    await setupClient.query(
      `delete from public.organization_users where organization_id = $1 and user_id = any($2::uuid[])`,
      [orgId, agentIds],
    );
    await setupClient.query(`delete from auth.users where id = any($1::uuid[])`, [
      agentIds,
    ]);
    await setupClient.end();
  });

  it(
    "release-blocking #1 and #2: " +
      `${AGENT_COUNT * LEADS_PER_AGENT} leads routed genuinely concurrently against a ` +
      `${AGENT_COUNT}-agent round robin produce an exact even split and zero duplicate active assignments`,
    async () => {
      const leadIds = Array.from(
        { length: AGENT_COUNT * LEADS_PER_AGENT },
        (_, i) =>
          `00000000-0000-4000-8000-0000000${(30000 + i).toString().padStart(5, "0")}`,
      );

      for (const leadId of leadIds) {
        await setupClient.query(
          `insert into public.leads (id, organization_id, first_name, email, lead_source_id)
           values ($1, $2, 'L', $3, $4)`,
          [leadId, orgId, `${leadId}@x.test`, sourceId],
        );
      }

      // Every lead gets its own real connection so all route_lead calls are
      // issued to Postgres at the same time, not serialized by a shared
      // client's single in-flight query.
      const clients = await Promise.all(leadIds.map(() => connectedClient()));
      try {
        const results = await Promise.all(
          clients.map((c, i) =>
            c.query(`select public.route_lead($1) as decision`, [leadIds[i]]),
          ),
        );

        for (const r of results) {
          expect(r.rows[0].decision.outcome).toBe("assigned");
        }

        const { rows: activeAssignments } = await setupClient.query(
          `select lead_id, user_id from public.assignments
           where organization_id = $1 and status in ('pending', 'notified', 'viewed')`,
          [orgId],
        );

        // Exactly one active assignment per lead — no duplicates.
        expect(activeAssignments).toHaveLength(leadIds.length);
        expect(new Set(activeAssignments.map((a) => a.lead_id)).size).toBe(
          leadIds.length,
        );

        // Round-robin state was not corrupted by concurrent cursor
        // read-modify-writes: distribution across the 5 agents is exactly
        // even, not skewed or missing an agent.
        const counts = new Map<string, number>();
        for (const a of activeAssignments) {
          counts.set(a.user_id, (counts.get(a.user_id) ?? 0) + 1);
        }
        expect(counts.size).toBe(AGENT_COUNT);
        for (const id of agentIds) {
          expect(counts.get(id)).toBe(LEADS_PER_AGENT);
        }
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    },
    30_000,
  );

  it("release-blocking #1: 25 concurrent route_lead calls for the SAME lead create exactly one active assignment", async () => {
    const leadId = "00000000-0000-4000-8000-000000031000";
    await setupClient.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id)
         values ($1, $2, 'L', 'race-same-lead@x.test', $3)`,
      [leadId, orgId, sourceId],
    );

    const CONCURRENCY = 25;
    const clients = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => connectedClient()),
    );
    try {
      const results = await Promise.all(
        clients.map((c) => c.query(`select public.route_lead($1) as decision`, [leadId])),
      );

      const outcomes = results.map((r) => r.rows[0].decision.outcome as string);
      expect(outcomes.every((o) => o === "assigned" || o === "already_assigned")).toBe(
        true,
      );
      expect(outcomes.filter((o) => o === "assigned")).toHaveLength(1);

      const { rows } = await setupClient.query(
        `select id from public.assignments
           where lead_id = $1 and status in ('pending', 'notified', 'viewed')`,
        [leadId],
      );
      expect(rows).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }, 30_000);

  it("release-blocking #4: simulate_routing run concurrently with real routing never writes to assignments/routing_state", async () => {
    const leadId = "00000000-0000-4000-8000-000000032000";
    const decoyLeadIds = Array.from(
      { length: 10 },
      (_, i) => `00000000-0000-4000-8000-00000003300${i}`,
    );

    await setupClient.query(
      `insert into public.leads (id, organization_id, first_name, email, lead_source_id)
         values ($1, $2, 'L', 'sim-target@x.test', $3)`,
      [leadId, orgId, sourceId],
    );
    for (const id of decoyLeadIds) {
      await setupClient.query(
        `insert into public.leads (id, organization_id, first_name, email, lead_source_id)
           values ($1, $2, 'L', $3, $4)`,
        [id, orgId, `${id}@x.test`, sourceId],
      );
    }

    const { rows: beforeState } = await setupClient.query(
      `select rotation_cursor from public.routing_state where organization_id = $1`,
      [orgId],
    );

    // 20 concurrent simulate_routing calls against the same lead,
    // interleaved with 10 concurrent real route_lead calls for other
    // leads — simulate_routing must never mutate assignments or the
    // round-robin cursor, even racing against real writes.
    const simClients = await Promise.all(
      Array.from({ length: 20 }, () => connectedClient()),
    );
    const realClients = await Promise.all(decoyLeadIds.map(() => connectedClient()));
    try {
      await Promise.all([
        ...simClients.map((c) => c.query(`select public.simulate_routing($1)`, [leadId])),
        ...realClients.map((c, i) =>
          c.query(`select public.route_lead($1)`, [decoyLeadIds[i]]),
        ),
      ]);

      const { rows: simTargetAssignments } = await setupClient.query(
        `select id from public.assignments where lead_id = $1`,
        [leadId],
      );
      expect(simTargetAssignments).toHaveLength(0);

      const { rows: afterState } = await setupClient.query(
        `select rotation_cursor from public.routing_state where organization_id = $1`,
        [orgId],
      );
      // The cursor moved only by the 10 real route_lead calls, never by
      // any of the 20 concurrent simulate_routing calls.
      expect(afterState[0].rotation_cursor - beforeState[0].rotation_cursor).toBe(
        decoyLeadIds.length,
      );
    } finally {
      await Promise.all([...simClients, ...realClients].map((c) => c.end()));
    }
  }, 30_000);
});
