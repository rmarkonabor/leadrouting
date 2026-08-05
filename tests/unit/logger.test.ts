import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "@/lib/logging/logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes allow-listed context keys in the emitted log line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("lead_routed", {
      organization_id: "org-1",
      lead_id: "lead-1",
      assignment_id: "assignment-1",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(logged.organization_id).toBe("org-1");
    expect(logged.lead_id).toBe("lead-1");
    expect(logged.assignment_id).toBe("assignment-1");
    expect(logged.event).toBe("lead_routed");
  });

  it("drops disallowed keys such as email, phone, and raw payloads", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // LogContext's index signature permits any string key at compile time —
    // the allow-list enforcement is a runtime guarantee, which is what this
    // test proves. A caller passing these keys would not get a type error,
    // which is exactly why the runtime drop below matters.
    logger.info("lead_received", {
      organization_id: "org-1",
      email: "person@example.com",
      raw_payload: '{"first_name":"Jane"}',
    });

    const logged = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<
      string,
      unknown
    >;
    expect(logged).not.toHaveProperty("email");
    expect(logged).not.toHaveProperty("raw_payload");
    expect(logged.organization_id).toBe("org-1");
  });

  it("routes error-level logs through console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.error("routing_failed", { organization_id: "org-1" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
