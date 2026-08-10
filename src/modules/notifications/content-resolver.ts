import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface ResolvedNotification {
  organizationId: string;
  userId: string;
  email: string | null;
  eventType: string;
  leadId: string | null;
  assignmentId: string | null;
  title: string;
  body: string;
}

export interface NotificationContentResolver {
  resolve(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<ResolvedNotification[]>;
}

/**
 * Resolves a queued notification event into one or more recipients with
 * rendered title/body. Runs against the service-role client since this is
 * an internal system process, not a request scoped to any one user — see
 * ADR-041/042. Content is deliberately generic (no raw lead payload,
 * message text, or custom variable values per CLAUDE.md rule 18) — just
 * enough for the assignee to know what changed and follow the link.
 */
export class SupabaseNotificationContentResolver implements NotificationContentResolver {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async resolve(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<ResolvedNotification[]> {
    switch (eventType) {
      case "new_lead_assignment":
        return this.resolveAssignmentEvent(
          eventType,
          payload,
          "New lead assigned to you",
          "You have a new lead assignment.",
        );
      case "assignment_expiration_warning":
        return this.resolveAssignmentEvent(
          eventType,
          payload,
          "Assignment expiring soon",
          "One of your lead assignments is approaching its acceptance deadline.",
        );
      case "assignment_expired":
        return this.resolveAssignmentEvent(
          eventType,
          payload,
          "Assignment expired",
          "One of your lead assignments expired without a response.",
        );
      case "lead_manual_review":
        return this.resolveManualReviewEvent(eventType, payload);
      default:
        return [];
    }
  }

  private async resolveAssignmentEvent(
    eventType: string,
    payload: Record<string, unknown>,
    title: string,
    body: string,
  ): Promise<ResolvedNotification[]> {
    const assignmentId = payload.assignment_id as string | undefined;
    const leadId = (payload.lead_id as string | undefined) ?? null;
    const userId = payload.user_id as string | undefined;
    if (!assignmentId || !userId) return [];

    const { data: assignment } = await this.client
      .from("assignments")
      .select("organization_id")
      .eq("id", assignmentId)
      .single();
    if (!assignment) return [];

    const email = await this.lookupEmail(userId);
    return [
      {
        organizationId: assignment.organization_id,
        userId,
        email,
        eventType,
        leadId,
        assignmentId,
        title,
        body,
      },
    ];
  }

  private async resolveManualReviewEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<ResolvedNotification[]> {
    const leadId = (payload.lead_id as string | undefined) ?? null;
    const manualReviewItemId = payload.manual_review_item_id as string | undefined;
    if (!manualReviewItemId || !leadId) return [];

    const { data: lead } = await this.client
      .from("leads")
      .select("organization_id")
      .eq("id", leadId)
      .single();
    if (!lead) return [];

    const { data: admins } = await this.client
      .from("organization_users")
      .select("user_id")
      .eq("organization_id", lead.organization_id)
      .eq("role", "org_admin")
      .eq("status", "active");

    const recipients: ResolvedNotification[] = [];
    for (const admin of admins ?? []) {
      const email = await this.lookupEmail(admin.user_id);
      recipients.push({
        organizationId: lead.organization_id,
        userId: admin.user_id,
        email,
        eventType,
        leadId,
        assignmentId: null,
        title: "Lead entered manual review",
        body: "A lead could not be routed automatically and needs manual review.",
      });
    }
    return recipients;
  }

  private async lookupEmail(userId: string): Promise<string | null> {
    const { data } = await this.client.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  }
}
