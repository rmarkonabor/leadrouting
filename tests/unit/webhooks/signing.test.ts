import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/modules/webhooks/signing";

describe("signPayload / verifySignature", () => {
  it("produces a signature that verifies against the same payload and secret", () => {
    const payload = JSON.stringify({ eventId: "evt-1", eventType: "lead.created" });
    const signature = signPayload(payload, "shh-secret");

    expect(verifySignature(payload, "shh-secret", signature)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const payload = JSON.stringify({ eventId: "evt-1" });
    const signature = signPayload(payload, "secret-a");

    expect(verifySignature(payload, "secret-b", signature)).toBe(false);
  });

  it("rejects a signature after the payload is tampered with (replay/tamper protection)", () => {
    const original = JSON.stringify({ eventId: "evt-1", amount: 100 });
    const signature = signPayload(original, "shh-secret");
    const tampered = JSON.stringify({ eventId: "evt-1", amount: 999999 });

    expect(verifySignature(tampered, "shh-secret", signature)).toBe(false);
  });

  it("is deterministic: the same payload and secret always produce the same signature", () => {
    const payload = JSON.stringify({ eventId: "evt-1" });
    expect(signPayload(payload, "secret")).toBe(signPayload(payload, "secret"));
  });
});
