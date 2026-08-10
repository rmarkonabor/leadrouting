import "server-only";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { serverEnv } from "@/lib/env/server";

/**
 * Application-level encryption for CRM credentials and webhook secrets
 * (docs/decisions.md ADR-051 — resolves ADR-003's "Vault vs pgcrypto"
 * open decision in favor of neither: Vault's management story needs
 * per-environment dashboard setup this codebase can't automate or test,
 * and passing a plaintext secret through a Postgres function argument for
 * pgcrypto to encrypt would put it in query logs — so encryption happens
 * here, in Node, before anything ever reaches Postgres. The database only
 * ever stores and returns opaque ciphertext (as a `text` column, not
 * `bytea` — sidesteps any ambiguity in how a JS client encodes binary
 * over PostgREST).
 *
 * AES-256-GCM, keyed by WEBHOOK_ENCRYPTION_KEY (server-only env var, never
 * NEXT_PUBLIC_*). The key is hashed with SHA-256 first so operators can set
 * it to any secret string/passphrase rather than needing an exact 32-byte
 * value.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  if (!serverEnv.WEBHOOK_ENCRYPTION_KEY) {
    throw new Error(
      "WEBHOOK_ENCRYPTION_KEY is not configured — required to encrypt/decrypt integration secrets.",
    );
  }
  return createHash("sha256").update(serverEnv.WEBHOOK_ENCRYPTION_KEY).digest();
}

/**
 * Encrypts a plaintext secret (CRM API token, webhook signing secret) into
 * an opaque hex string: `iv || authTag || ciphertext`, all hex-encoded and
 * concatenated. Never logged, never sent to Sentry — callers must treat the
 * plaintext input the same way (CLAUDE.md rule 18 / kickoff requirement 13).
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("hex");
}

/**
 * Reverses `encryptSecret`. Throws if the stored value was tampered with
 * (GCM's auth tag check fails) or encrypted under a different key.
 */
export function decryptSecret(stored: string): string {
  const raw = Buffer.from(stored, "hex");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Generates a new random webhook signing secret (32 bytes, hex-encoded). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}
