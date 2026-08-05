import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Real Postgres RLS/tenant-isolation tests. Skipped unless a local Supabase
 * Postgres instance is reachable — see ./README.md for how to run them.
 * This is the "RLS tests where practical" / "tenant isolation tests"
 * requirement made concrete rather than mocked, since RLS correctness
 * cannot be verified without a real Postgres engine evaluating policies.
 */
describe.skipIf(!TEST_DATABASE_URL)("tenant isolation (Row Level Security)", () => {
  const client = new Client({ connectionString: TEST_DATABASE_URL });

  const orgAId = "00000000-0000-4000-8000-000000000001";
  const orgBId = "00000000-0000-4000-8000-000000000002";
  const userAId = "00000000-0000-4000-8000-0000000000a1";
  const userBId = "00000000-0000-4000-8000-0000000000b1";

  beforeAll(async () => {
    await client.connect();
    await client.query("begin");

    // Seed two auth users directly (test-only shortcut; normally GoTrue
    // owns this table). Minimal columns required for a valid auth.users row.
    for (const [id, email] of [
      [userAId, "user-a@example.test"],
      [userBId, "user-b@example.test"],
    ] as const) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1, $2, 'x', now(), 'authenticated', 'authenticated')
         on conflict (id) do nothing`,
        [id, email],
      );
    }

    await client.query(
      `insert into public.organizations (id, name, slug) values
         ($1, 'Org A', 'org-a'),
         ($2, 'Org B', 'org-b')
       on conflict (id) do nothing`,
      [orgAId, orgBId],
    );

    await client.query(
      `insert into public.organization_users (organization_id, user_id, role, status)
       values
         ($1, $2, 'org_admin', 'active'),
         ($3, $4, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
      [orgAId, userAId, orgBId, userBId],
    );
  });

  afterAll(async () => {
    await client.query("rollback");
    await client.end();
  });

  async function queryAsUser(userId: string) {
    await client.query("set local role authenticated");
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
      [userId],
    );
    const result = await client.query("select id, slug from public.organizations");
    await client.query("reset role");
    return result.rows as Array<{ id: string; slug: string }>;
  }

  it("only shows a user their own organization, not another organization's", async () => {
    const orgsForUserA = await queryAsUser(userAId);
    expect(orgsForUserA.map((row) => row.slug)).toEqual(["org-a"]);

    const orgsForUserB = await queryAsUser(userBId);
    expect(orgsForUserB.map((row) => row.slug)).toEqual(["org-b"]);
  });

  it("hides all organizations once the membership is inactive", async () => {
    await client.query(
      `update public.organization_users set status = 'inactive'
       where organization_id = $1 and user_id = $2`,
      [orgAId, userAId],
    );

    const orgsForUserA = await queryAsUser(userAId);
    expect(orgsForUserA).toEqual([]);

    // Restore for any subsequent test in this file.
    await client.query(
      `update public.organization_users set status = 'active'
       where organization_id = $1 and user_id = $2`,
      [orgAId, userAId],
    );
  });

  it("rejects bootstrap_organization() with no authenticated caller", async () => {
    await client.query("set local role authenticated");
    await client.query(`select set_config('request.jwt.claims', '{}', true)`);

    await expect(
      client.query(`select public.bootstrap_organization('Rogue Org', 'rogue-org')`),
    ).rejects.toThrow(/not authenticated/);

    await client.query("reset role");
  });
});
