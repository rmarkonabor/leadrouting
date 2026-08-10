import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing for outbound webhook payloads (spec §43 requirement
 * 1: "Signed payloads"). Signs the exact JSON string that will be sent, so
 * the receiver can verify by re-computing the same HMAC over the raw
 * request body — the standard signed-webhook pattern.
 */
export function signPayload(payloadJson: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadJson).digest("hex");
}

export function verifySignature(
  payloadJson: string,
  secret: string,
  signature: string,
): boolean {
  const expected = signPayload(payloadJson, secret);
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
