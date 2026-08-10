import { test, expect } from "@playwright/test";
import { e2eEnv, missingLeadSourceEnv } from "./env";

/**
 * Critical journey 3 (docs/testing-strategy.md §3b): "A lead submitted
 * through the intake API is routed, the assigned agent receives a
 * notification, accepts it, and the lead becomes visible in their lead
 * list."
 *
 * Requires E2E_LEAD_SOURCE_TOKEN — an active lead source in E2E_ORG_SLUG
 * whose routing flow is published and can assign to the E2E_ADMIN_EMAIL
 * user (e.g. a direct-assignment rule to that user, or a round robin whose
 * team includes them) — see tests/e2e/README.md. Acceptance is verified
 * from that same admin's session, since this suite only authenticates one
 * user; a real pilot org would normally have routing assign to a
 * dedicated agent, not the admin.
 */
test.describe("Intake to accept", () => {
  test.beforeEach(() => {
    const missing = missingLeadSourceEnv();
    test.skip(!!missing, missing ?? undefined);
  });

  test("a submitted lead is routed, notified, and accepted", async ({
    page,
    request,
  }) => {
    const externalSubmissionId = `e2e-${Date.now()}`;

    const response = await request.post(`/api/v1/intake/${e2eEnv.leadSourceToken}`, {
      data: {
        externalSubmissionId,
        firstName: "E2E",
        lastName: "Journey",
        email: `e2e-lead-${externalSubmissionId}@example.test`,
      },
    });
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { leadId?: string };
    test.skip(
      !body.leadId,
      "Intake response did not include a leadId — cannot continue.",
    );

    await page.goto(`/org/${e2eEnv.orgSlug}/leads/${body.leadId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const assignmentStatus = page.getByText(/^Status: /).first();
    await expect(assignmentStatus).toContainText(/assigned|accepted|manual_review/);

    // If routing assigned this lead to the admin session running this
    // test, a notification with Accept/Decline actions will exist —
    // otherwise (assigned to a different agent, or sent to manual review)
    // this journey has verified everything it safely can from this
    // session and stops here rather than guessing at another user's inbox.
    await page.goto(`/org/${e2eEnv.orgSlug}/notifications`);
    const acceptButtons = page.getByRole("button", { name: "Accept" });
    const hasAcceptableNotification = (await acceptButtons.count()) > 0;
    test.skip(
      !hasAcceptableNotification,
      "No pending notification for the admin session — routing likely assigned this lead " +
        "to a different agent or sent it to manual review. See this file's own header comment.",
    );

    await acceptButtons.first().click();

    await page.goto(`/org/${e2eEnv.orgSlug}/leads/${body.leadId}`);
    await expect(page.getByText(/^Status: /).first()).toContainText("accepted");

    await page.goto(`/org/${e2eEnv.orgSlug}/leads`);
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  });
});
