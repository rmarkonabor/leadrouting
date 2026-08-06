import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres RLS tests for Milestone 2 (teams, team_users, availability,
 * recipient attributes, audit_logs). See tests/integration/README.md for how
 * to run these — skipped automatically without TEST_DATABASE_URL, same as
 * tests/integration/rls-tenant-isolation.test.ts.
 */
describe.skipIf(!TEST_DATABASE_URL)(
  "Milestone 2 tenant isolation and role scoping",
  () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });

    const orgAId = "00000000-0000-4000-8000-000000000101";
    const orgBId = "00000000-0000-4000-8000-000000000102";
    const adminAId = "00000000-0000-4000-8000-0000000001a1";
    const managerAId = "00000000-0000-4000-8000-0000000001a2";
    const agent1Id = "00000000-0000-4000-8000-0000000001a3";
    const agent2Id = "00000000-0000-4000-8000-0000000001a4";
    const teamAId = "00000000-0000-4000-8000-0000000002a1";
    const teamBId = "00000000-0000-4000-8000-0000000002a2";

    beforeAll(async () => {
      await client.connect();
      await client.query("begin");

      for (const [id, email] of [
        [adminAId, "admin-a@example.test"],
        [managerAId, "manager-a@example.test"],
        [agent1Id, "agent1-a@example.test"],
        [agent2Id, "agent2-a@example.test"],
      ] as const) {
        await client.query(
          `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated')
         on conflict (id) do nothing`,
          [id, email],
        );
      }

      await client.query(
        `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm2-org-a'), ($2, 'Org B', 'm2-org-b')
       on conflict (id) do nothing`,
        [orgAId, orgBId],
      );

      await client.query(
        `insert into public.organization_users (organization_id, user_id, role, status) values
         ($1, $2, 'org_admin', 'active'),
         ($1, $3, 'team_manager', 'active'),
         ($1, $4, 'agent', 'active'),
         ($1, $5, 'agent', 'active')
       on conflict (organization_id, user_id) do nothing`,
        [orgAId, adminAId, managerAId, agent1Id, agent2Id],
      );

      await client.query(
        `insert into public.teams (id, organization_id, name) values ($1, $2, 'Team A'), ($3, $2, 'Team B')
       on conflict (id) do nothing`,
        [teamAId, orgAId, teamBId],
      );

      await client.query(
        `insert into public.team_users (organization_id, team_id, user_id, is_manager) values
         ($1, $2, $3, true),
         ($1, $2, $4, false)
       on conflict (team_id, user_id) do nothing`,
        [orgAId, teamAId, managerAId, agent1Id],
      );
    });

    afterAll(async () => {
      await client.query("rollback");
      await client.end();
    });

    // Some tests below deliberately trigger a Postgres error (RLS/trigger
    // rejection) via `.rejects.toThrow()`. In Postgres, any error inside a
    // transaction aborts the *entire* transaction until a ROLLBACK — since
    // every test here shares one transaction (rolled back only in
    // afterAll), a rejected query would otherwise poison every subsequent
    // test with "current transaction is aborted." A per-test SAVEPOINT,
    // rolled back after each test regardless of outcome, isolates each
    // test's queries (including any deliberate errors) from the others.
    beforeEach(async () => {
      await client.query("savepoint test_savepoint");
    });

    afterEach(async () => {
      await client.query("rollback to savepoint test_savepoint");
    });

    async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
      await client.query("set local role authenticated");
      await client.query(
        `select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
        [userId],
      );
      try {
        return await fn();
      } finally {
        await client.query("reset role");
      }
    }

    it("audit requirement 1: an agent cannot read another agent's team_users row", async () => {
      const rows = await asUser(agent1Id, async () => {
        const result = await client.query(
          "select user_id from public.team_users where team_id = $1",
          [teamAId],
        );
        return result.rows as Array<{ user_id: string }>;
      });

      // agent1 sees only their own row (self), not manager's or any other
      // agent's row in the same team.
      expect(rows.map((r) => r.user_id)).toEqual([agent1Id]);
    });

    it("audit requirement 2: a team_manager cannot administer (insert into) a team they do not manage", async () => {
      await expect(
        asUser(managerAId, () =>
          client.query(
            `insert into public.team_users (organization_id, team_id, user_id, is_manager)
           values ($1, $2, $3, false)`,
            [orgAId, teamBId, agent2Id],
          ),
        ),
      ).rejects.toThrow();
    });

    it("audit requirement 2b: a team_manager cannot administer the team they do manage either (org_admin only)", async () => {
      await expect(
        asUser(managerAId, () =>
          client.query(
            `insert into public.team_users (organization_id, team_id, user_id, is_manager)
           values ($1, $2, $3, false)`,
            [orgAId, teamAId, agent2Id],
          ),
        ),
      ).rejects.toThrow();
    });

    it("audit requirement 3: an org_admin cannot access another organization's teams", async () => {
      const rows = await asUser(adminAId, async () => {
        const result = await client.query(
          "select id from public.teams where organization_id = $1",
          [orgBId],
        );
        return result.rows;
      });
      expect(rows).toEqual([]);
    });

    it("audit requirement 4: an agent cannot promote their own role via organization_users", async () => {
      await expect(
        asUser(agent1Id, () =>
          client.query(
            `update public.organization_users set role = 'org_admin' where user_id = $1`,
            [agent1Id],
          ),
        ),
      ).resolves.toBeDefined();

      // The UPDATE either matches zero rows (RLS silently filters it out) or
      // throws; either way the role must not actually change.
      const rows = await asUser(adminAId, async () => {
        const result = await client.query(
          `select role from public.organization_users where user_id = $1 and organization_id = $2`,
          [agent1Id, orgAId],
        );
        return result.rows as Array<{ role: string }>;
      });
      expect(rows[0]?.role).toBe("agent");
    });

    it("audit requirement 8: audit_logs are readable only by org_admin, and insertable only as the real actor", async () => {
      await asUser(adminAId, () =>
        client.query(
          `insert into public.audit_logs (organization_id, actor_user_id, action, entity_type)
         values ($1, $2, 'team_created', 'team')`,
          [orgAId, adminAId],
        ),
      );

      const asAgent = await asUser(agent1Id, async () => {
        const result = await client.query(
          "select id from public.audit_logs where organization_id = $1",
          [orgAId],
        );
        return result.rows;
      });
      expect(asAgent).toEqual([]);

      const asAdmin = await asUser(adminAId, async () => {
        const result = await client.query(
          "select id from public.audit_logs where organization_id = $1",
          [orgAId],
        );
        return result.rows;
      });
      expect(asAdmin.length).toBeGreaterThan(0);

      // Cannot insert an audit row impersonating a different actor.
      await expect(
        asUser(agent1Id, () =>
          client.query(
            `insert into public.audit_logs (organization_id, actor_user_id, action, entity_type)
           values ($1, $2, 'user_role_changed', 'organization_users')`,
            [orgAId, adminAId],
          ),
        ),
      ).rejects.toThrow();
    });
  },
);
