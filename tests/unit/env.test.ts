import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("public env validation", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("loads successfully when all required public vars are present", async () => {
    const { publicEnv } = await import("@/lib/env/public");
    expect(publicEnv.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    vi.resetModules();
    const withoutUrl = { ...process.env };
    delete withoutUrl.NEXT_PUBLIC_SUPABASE_URL;
    process.env = withoutUrl;

    await expect(import("@/lib/env/public")).rejects.toThrow(
      /Invalid public environment configuration/,
    );
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is not a valid URL", async () => {
    vi.resetModules();
    process.env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" };

    await expect(import("@/lib/env/public")).rejects.toThrow(
      /Invalid public environment configuration/,
    );
  });
});

describe("server env validation", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("loads successfully when SUPABASE_SECRET_KEY is present", async () => {
    const { serverEnv } = await import("@/lib/env/server");
    expect(serverEnv.SUPABASE_SECRET_KEY).toBe("test-secret-key");
  });

  it("throws when SUPABASE_SECRET_KEY is missing", async () => {
    const withoutSecret = { ...process.env };
    delete withoutSecret.SUPABASE_SECRET_KEY;
    process.env = withoutSecret;

    await expect(import("@/lib/env/server")).rejects.toThrow(
      /Invalid server environment configuration/,
    );
  });

  it("does not require the optional later-milestone vars", async () => {
    const withoutOptional = { ...process.env };
    delete withoutOptional.EMAIL_PROVIDER_API_KEY;
    delete withoutOptional.CRM_CLIENT_SECRET;
    process.env = withoutOptional;

    await expect(import("@/lib/env/server")).resolves.toBeDefined();
  });
});
