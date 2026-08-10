import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres RLS tests for Milestone 4 (territories, territory_users,
 * territory_teams, lead_locations_internal). See tests/integration/README.md
 * for how to run these — skipped automatically without TEST_DATABASE_URL.
 */
describe.skipIf(!TEST_DATABASE_URL)("Milestone 4 tenant isolation", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000301";
  const orgBId = "00000000-0000-4000-8000-000000000302";
  const adminAId = "00000000-0000-4000-8000-0000000005a1";
  const agentAId = "00000000-0000-4000-8000-0000000005a2";
  const territoryAId = "00000000-0000-4000-8000-0000000006a1";
  const territoryBId = "00000000-0000-4000-8000-0000000006b1";

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    for (const [id, email] of [
      [adminAId, "admin-a-m4@example.test"],
      [agentAId, "agent-a-m4@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated')
         on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm4-org-a'), ($2, 'Org B', 'm4-org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );

    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status) values
       ($1, $2, 'org_admin', 'active'),
       ($1, $3, 'agent', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, adminAId, agentAId],
    );

    await client.query(
      `insert into public.territories (id, organization_id, name, territory_type, postal_code, status)
       values ($1, $2, 'Org A Territory', 'postal_code', 'M5V 1J2', 'active'),
              ($3, $4, 'Org B Territory', 'postal_code', 'K1A 0A6', 'active')
       on conflict (id) do nothing`,
      [territoryAId, orgAId, territoryBId, orgBId],
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

  it("an active member cannot read another organization's territories", async () => {
    const rows = await asUser(adminAId, async () => {
      const result = await client.query(
        "select id from public.territories where organization_id = $1",
        [orgBId],
      );
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it("an active member can read their own organization's territories", async () => {
    const rows = await asUser(adminAId, async () => {
      const result = await client.query(
        "select id from public.territories where organization_id = $1",
        [orgAId],
      );
      return result.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([territoryAId]);
  });

  it("an agent (non-admin) cannot create a territory", async () => {
    await expect(
      asUser(agentAId, () =>
        client.query(
          `insert into public.territories (organization_id, name, territory_type, country)
           values ($1, 'New Territory', 'country', 'Canada')`,
          [orgAId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("an org_admin cannot read lead_locations_internal for another organization", async () => {
    const rows = await asUser(adminAId, async () => {
      const result = await client.query(
        "select id from public.lead_locations_internal where organization_id = $1",
        [orgBId],
      );
      return result.rows;
    });
    expect(rows).toEqual([]);
  });
});
