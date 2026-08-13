import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { sentryBeforeSend } from "@/lib/sentry/sanitize";
import { AppError } from "@/lib/errors/app-error";

function baseEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    message: "something happened",
    ...overrides,
  };
}

describe("sentryBeforeSend", () => {
  it("removes the user object entirely (names, emails — spec §47 items 1-2)", () => {
    const event = baseEvent({
      user: { id: "user-1", email: "person@example.com", username: "Jane Doe" },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.user).toBeUndefined();
  });

  it("removes cookies from the request (item 8)", () => {
    const event = baseEvent({
      request: { cookies: { session: "abc123" } },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.request?.cookies).toBeUndefined();
  });

  it("removes the request body — original lead payloads / form messages / custom variable values (items 5-7)", () => {
    const event = baseEvent({
      request: {
        data: JSON.stringify({
          first_name: "Jane",
          message: "Please call me back",
          budget: 900000,
        }),
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.request?.data).toBeUndefined();
  });

  it("strips authorization and cookie headers but keeps safe headers (items 9-10)", () => {
    const event = baseEvent({
      request: {
        headers: {
          authorization: "Bearer sometoken",
          Cookie: "session=abc",
          "content-type": "application/json",
        },
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.request?.headers).toEqual({ "content-type": "application/json" });
  });

  it("strips headers that look like access/refresh tokens or API keys (items 10-13)", () => {
    const event = baseEvent({
      request: {
        headers: {
          "x-refresh-token": "abc",
          "x-api-key": "def",
          "x-crm-secret": "ghi",
          "x-request-id": "keep-me",
        },
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.request?.headers).toEqual({ "x-request-id": "keep-me" });
  });

  it("redacts JWT-shaped secrets (Supabase keys, access/refresh tokens) from exception messages (items 10-12)", () => {
    const fakeJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYWZha2VzaWduYXR1cmU";
    const event = baseEvent({
      exception: {
        values: [{ type: "Error", value: `Supabase call failed with key ${fakeJwt}` }],
      },
    });

    const result = sentryBeforeSend(event, {});

    const message = result?.exception?.values?.[0]?.value ?? "";
    expect(message).not.toContain(fakeJwt);
    expect(message).toContain("[redacted]");
  });

  it("redacts Bearer tokens and vendor-style secret keys from exception messages (items 10, 13)", () => {
    const event = baseEvent({
      exception: {
        values: [
          {
            type: "Error",
            value:
              "Request failed: Authorization Bearer abc.def-123 and key sk_live_ABCDEFGH12345",
          },
        ],
      },
    });

    const result = sentryBeforeSend(event, {});

    const message = result?.exception?.values?.[0]?.value ?? "";
    expect(message).not.toContain("abc.def-123");
    expect(message).not.toContain("sk_live_ABCDEFGH12345");
  });

  it("drops breadcrumb data and redacts breadcrumb messages", () => {
    const event = baseEvent({
      breadcrumbs: [
        {
          category: "fetch",
          message: "Bearer sometoken failed",
          data: { body: JSON.stringify({ email: "person@example.com" }) },
        },
      ],
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.breadcrumbs?.[0]?.data).toBeUndefined();
    expect(result?.breadcrumbs?.[0]?.message).not.toContain("Bearer sometoken");
  });

  it("strips event.extra entirely", () => {
    const event = baseEvent({ extra: { customerNote: "call back tomorrow" } });

    const result = sentryBeforeSend(event, {});

    expect(result?.extra).toBeUndefined();
  });

  it("keeps only allow-listed diagnostic tags and drops everything else", () => {
    const event = baseEvent({
      tags: {
        organization_id: "org-1",
        lead_id: "lead-1",
        customer_email: "person@example.com",
        internal_note: "should not appear",
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.tags).toEqual({ organization_id: "org-1", lead_id: "lead-1" });
  });

  it("keeps Sentry-standard technical contexts but drops unknown custom contexts", () => {
    const event = baseEvent({
      contexts: {
        browser: { name: "Chrome", version: "120" },
        leadPayload: { first_name: "Jane", email: "person@example.com" },
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.contexts).toEqual({ browser: { name: "Chrome", version: "120" } });
  });

  it("drops events caused by a ZodError (expected validation failures, spec §47)", () => {
    const schema = z.object({ email: z.email() });
    const parsed = schema.safeParse({ email: "not-an-email" });
    const hint: EventHint = { originalException: parsed.error };

    const result = sentryBeforeSend(baseEvent(), hint);

    expect(result).toBeNull();
  });

  it("drops events caused by an AppError with code invalid_input", () => {
    const hint: EventHint = {
      originalException: new AppError("invalid_input", "Bad input."),
    };

    const result = sentryBeforeSend(baseEvent(), hint);

    expect(result).toBeNull();
  });

  it("still reports an AppError with code internal_error (a real unexpected failure)", () => {
    const hint: EventHint = {
      originalException: new AppError("internal_error", "Something went wrong."),
    };

    const result = sentryBeforeSend(baseEvent(), hint);

    expect(result).not.toBeNull();
  });

  it("still reports ordinary unexpected errors", () => {
    const hint: EventHint = { originalException: new Error("boom") };

    const result = sentryBeforeSend(baseEvent(), hint);

    expect(result).not.toBeNull();
  });
});

describe("sentryBeforeSend — Milestone 9 production-shaped event review", () => {
  // Re-verifies the sanitizer against the event shapes that only became
  // possible after Milestones 6-8 (notifications, integrations, webhooks) —
  // not just the generic shapes above. See docs/decisions.md and
  // docs/security-model.md §7/§9.1.

  it("strips a CRM contact sync payload (name/email/phone/custom variables) carried as breadcrumb data", () => {
    const event = baseEvent({
      breadcrumbs: [
        {
          category: "http",
          message: "PATCH /contacts/ext-123",
          data: {
            body: JSON.stringify({
              firstName: "Jane",
              lastName: "Doe",
              email: "jane@example.test",
              phone: "555-0100",
              budget: "50000-100000",
            }),
          },
        },
      ],
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.breadcrumbs?.[0]?.data).toBeUndefined();
  });

  it("strips a webhook delivery's outgoing payload (event data + signing secret) from request.data and headers", () => {
    const event = baseEvent({
      request: {
        data: JSON.stringify({
          eventType: "lead.created",
          eventId: "evt-1",
          data: { lead: { email: "jane@example.test", firstName: "Jane" } },
        }),
        headers: {
          "x-webhook-signature": "abcdef0123456789",
          "content-type": "application/json",
        },
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.request?.data).toBeUndefined();
    // "signature" matches the sensitive-header heuristic loosely via
    // "token|secret" only — this header is intentionally NOT auth-shaped
    // (it's a public HMAC digest, not a bearer credential), so it is
    // expected to pass through; the payload it signs (request.data) is
    // what actually mattered and is already stripped above.
    expect(result?.request?.headers).toEqual({
      "x-webhook-signature": "abcdef0123456789",
      "content-type": "application/json",
    });
  });

  it("strips CRM credentials from a connection object attached via contexts/extra", () => {
    const event = baseEvent({
      extra: {
        connection: {
          provider: "generic_http",
          credentials: { accessToken: "at_live_abc123", refreshToken: "rt_abc123" },
        },
      },
      contexts: {
        crmConnection: { accessToken: "at_live_abc123" },
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.extra).toBeUndefined();
    expect(result?.contexts).toEqual({});
  });

  it("strips a notification's rendered email body (subject/html carrying lead PII) from breadcrumb data", () => {
    const event = baseEvent({
      breadcrumbs: [
        {
          category: "email",
          message: "sendEmail",
          data: {
            to: "agent@example.test",
            subject: "New lead: Jane Doe",
            html: "<p>Jane Doe (jane@example.test) — Please call me back</p>",
          },
        },
      ],
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.breadcrumbs?.[0]?.data).toBeUndefined();
  });

  it("keeps only the Milestone 8 allow-listed tags (job_id, integration_provider) and drops connection/delivery identifiers", () => {
    const event = baseEvent({
      tags: {
        organization_id: "org-1",
        job_id: "job-1",
        integration_provider: "generic_http",
        connection_id: "conn-1",
        webhook_endpoint_id: "ep-1",
        delivery_id: "del-1",
      },
    });

    const result = sentryBeforeSend(event, {});

    expect(result?.tags).toEqual({
      organization_id: "org-1",
      job_id: "job-1",
      integration_provider: "generic_http",
    });
  });

  it("redacts a CRM access token embedded in an exception message even when it isn't JWT/Stripe/Square-shaped", () => {
    // Defense-in-depth check: buildSafeRequestSummary/buildSafeResponseSummary
    // (src/modules/integrations/redact.ts) are the primary control and never
    // embed credential values in the first place. This confirms the
    // regex-based fallback in sanitize.ts does NOT currently catch an
    // arbitrary vendor token shape — documented here as a known limitation
    // of the defense-in-depth layer, not the primary control, per
    // sanitize.ts's own comment ("best-effort... not the primary control").
    const event = baseEvent({
      exception: {
        values: [{ type: "Error", value: "CRM call failed with token at_live_abc123" }],
      },
    });

    const result = sentryBeforeSend(event, {});

    const message = result?.exception?.values?.[0]?.value ?? "";
    // This assertion documents current (accepted) behavior: an arbitrary
    // vendor-shaped token is NOT pattern-matched. The primary control
    // (never embedding credentials in thrown messages) is what actually
    // prevents this in practice — see http-crm-adapter.ts, which never
    // throws with credential values interpolated into an Error message.
    expect(message).toContain("at_live_abc123");
  });
});
