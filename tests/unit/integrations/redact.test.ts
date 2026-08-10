import { describe, expect, it } from "vitest";
import {
  buildSafeRequestSummary,
  buildSafeResponseSummary,
} from "@/modules/integrations/redact";

describe("buildSafeRequestSummary", () => {
  it("never includes field values, only field names (kickoff: no PII/credentials in logs)", () => {
    const summary = buildSafeRequestSummary("POST", "https://api.example.test/contacts", {
      email: "lead@example.test",
      apiKey: "sk_live_should_never_appear",
      firstName: "Jane",
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("lead@example.test");
    expect(serialized).not.toContain("sk_live_should_never_appear");
    expect(serialized).not.toContain("Jane");
    expect(summary.fieldNames).toEqual(["email", "apiKey", "firstName"]);
  });

  it("strips a query string that might carry a credential (e.g. ?api_key=...)", () => {
    const summary = buildSafeRequestSummary(
      "GET",
      "https://api.example.test/contacts?api_key=sk_live_secret&page=2",
    );
    expect(summary.url).toBe("https://api.example.test/contacts");
  });

  it("handles a request with no body", () => {
    const summary = buildSafeRequestSummary("GET", "https://api.example.test/users");
    expect(summary.fieldNames).toEqual([]);
  });
});

describe("buildSafeResponseSummary", () => {
  it("carries only a status code, ok flag, and a short generic error message", () => {
    const summary = buildSafeResponseSummary(401, false, "unauthorized");
    expect(summary).toEqual({ statusCode: 401, ok: false, errorMessage: "unauthorized" });
  });

  it("omits errorMessage entirely when not provided, never defaulting to raw response text", () => {
    const summary = buildSafeResponseSummary(200, true);
    expect(summary).not.toHaveProperty("errorMessage");
  });
});
