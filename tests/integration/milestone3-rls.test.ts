import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Real Postgres RLS/function tests for Milestone 3 (lead_sources, leads,
 * submission_logs, resolve_lead_source, record_lead_submission). See
 * tests/integration/README.md for how to run these — skipped automatically
 * without TEST_DATABASE_URL.
 */
describe.skipIf(!TEST_DATABASE_URL)(
  "Milestone 3 tenant isolation and intake functions",
  () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });

    const orgAId = "00000000-0000-4000-8000-000000000201";
    const orgBId = "00000000-0000-4000-8000-000000000202";
    const adminAId = "00000000-0000-4000-8000-0000000003a1";
    const sourceAId = "00000000-0000-4000-8000-0000000004a1";
    const sourceBId = "00000000-0000-4000-8000-0000000004b1";
    const plaintextTokenA = "lrt_test_token_org_a";
    const plaintextTokenB = "lrt_test_token_org_b";

    beforeAll(async () => {
      await client.connect();
      await client.query("begin");

      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
       values ($1, 'admin-a-m3@example.test', 'x', now(), 'authenticated', 'authenticated')
       on conflict (id) do nothing`,
        [adminAId],
      );

      await client.query(
        `insert into public.organizations (id, name, slug) values ($1, 'Org A', 'm3-org-a'), ($2, 'Org B', 'm3-org-b')
       on conflict (id) do nothing`,
        [orgAId, orgBId],
      );

      await client.query(
        `insert into public.organization_users (organization_id, user_id, role, status) values ($1, $2, 'org_admin', 'active')
       on conflict (organization_id, user_id) do nothing`,
        [orgAId, adminAId],
      );

      await client.query(
        `insert into public.lead_sources (id, organization_id, name, source_type, source_token_hash)
       values ($1, $2, 'Org A Source', 'api', $3), ($4, $5, 'Org B Source', 'api', $6)
       on conflict (id) do nothing`,
        [
          sourceAId,
          orgAId,
          hashToken(plaintextTokenA),
          sourceBId,
          orgBId,
          hashToken(plaintextTokenB),
        ],
      );
    });

    afterAll(async () => {
      await client.query("rollback");
      await client.end();
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

    it("an org_admin cannot read another organization's lead sources", async () => {
      const rows = await asUser(adminAId, async () => {
        const result = await client.query(
          "select id from public.lead_sources where organization_id = $1",
          [orgBId],
        );
        return result.rows;
      });
      expect(rows).toEqual([]);
    });

    it("resolve_lead_source resolves the correct organization for a valid token", async () => {
      await client.query("set local role anon");
      const result = await client.query("select * from public.resolve_lead_source($1)", [
        hashToken(plaintextTokenA),
      ]);
      await client.query("reset role");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].organization_id).toBe(orgAId);
      expect(result.rows[0].status).toBe("active");
    });

    it("resolve_lead_source returns no rows for an unknown token", async () => {
      await client.query("set local role anon");
      const result = await client.query("select * from public.resolve_lead_source($1)", [
        hashToken("not-a-real-token"),
      ]);
      await client.query("reset role");

      expect(result.rows).toHaveLength(0);
    });

    it("record_lead_submission is idempotent: the same idempotency key returns the original result", async () => {
      await client.query("set local role anon");

      const first = await client.query(
        `select * from public.record_lead_submission(
        $1, $2, null, $3::jsonb, $4::jsonb, $5::jsonb, 'validated', false,
        $6::jsonb, 'unique', null, null, null, null
      )`,
        [
          sourceAId,
          "idem-key-integration-test",
          JSON.stringify({ email: "jane@example.com" }),
          JSON.stringify({ email: "jane@example.com" }),
          JSON.stringify([]),
          JSON.stringify({ email: "jane@example.com" }),
        ],
      );

      const second = await client.query(
        `select * from public.record_lead_submission(
        $1, $2, null, $3::jsonb, $4::jsonb, $5::jsonb, 'validated', false,
        $6::jsonb, 'unique', null, null, null, null
      )`,
        [
          sourceAId,
          "idem-key-integration-test",
          JSON.stringify({ email: "jane@example.com" }),
          JSON.stringify({ email: "jane@example.com" }),
          JSON.stringify([]),
          JSON.stringify({ email: "jane@example.com" }),
        ],
      );

      await client.query("reset role");

      expect(second.rows[0].submission_log_id).toBe(first.rows[0].submission_log_id);
      expect(second.rows[0].lead_id).toBe(first.rows[0].lead_id);

      const leadCount = await client.query(
        "select count(*)::int as count from public.leads where organization_id = $1 and email = 'jane@example.com'",
        [orgAId],
      );
      expect(leadCount.rows[0].count).toBe(1);
    });

    it("an org_admin cannot read leads belonging to another organization", async () => {
      const rows = await asUser(adminAId, async () => {
        const result = await client.query(
          "select id from public.leads where organization_id = $1",
          [orgBId],
        );
        return result.rows;
      });
      expect(rows).toEqual([]);
    });
  },
);
