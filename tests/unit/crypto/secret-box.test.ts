import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.WEBHOOK_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
});

describe("secret-box", () => {
  it("round-trips a secret through encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto/secret-box");
    const plaintext = "sk_live_super_secret_api_key";
    const encrypted = encryptSecret(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    const { encryptSecret } = await import("@/lib/crypto/secret-box");
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt a tampered ciphertext (GCM auth tag check)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto/secret-box");
    const encrypted = encryptSecret("tamper-test");
    const tampered =
      encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "11" : "00");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("generates a 64-char hex webhook secret", async () => {
    const { generateWebhookSecret } = await import("@/lib/crypto/secret-box");
    const secret = generateWebhookSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });
});
