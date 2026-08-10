import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serverEnv } from "@/lib/env/server";
import { setSentryDiagnosticContext } from "@/lib/sentry/diagnostics";
import { processAssignmentNotificationBatch } from "@/modules/notifications/process-assignment-notifications";
import { SupabaseQueueAdapter } from "@/modules/notifications/queue-adapter";
import { LoggingEmailAdapter } from "@/modules/notifications/email-adapter";
import { SupabaseNotificationContentResolver } from "@/modules/notifications/content-resolver";
import { SupabaseJobStatusChecker } from "@/modules/notifications/job-status";
import type { NotificationRecorder } from "@/modules/notifications/process-assignment-notifications";
import type { ResolvedNotification } from "@/modules/notifications/content-resolver";

// Internal, not part of the public API surface — never listed in
// docs/api-specification.md. Invoked by Supabase Cron's pg_net HTTP call
// (see the Milestone 6 migration's cron.schedule block) on a fixed
// interval, authenticated by a shared secret rather than a user session
// since there is no end user behind this request. This is the one route
// in the codebase allowed to import the service-role client for the same
// reason src/modules/notifications is on the ESLint allow-list: it acts as
// an internal system process, not on behalf of any single organization.

class SupabaseNotificationRecorder implements NotificationRecorder {
  constructor(private readonly client: ReturnType<typeof createServiceRoleClient>) {}

  async record(notification: ResolvedNotification): Promise<void> {
    const { error } = await this.client.rpc("record_notification", {
      p_organization_id: notification.organizationId,
      p_user_id: notification.userId,
      p_event_type: notification.eventType,
      p_lead_id: notification.leadId,
      p_assignment_id: notification.assignmentId,
      p_title: notification.title,
      p_body: notification.body,
    });
    if (error) throw error;
  }
}

export async function POST(request: NextRequest) {
  if (!serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (providedSecret !== serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = createServiceRoleClient();

  const result = await processAssignmentNotificationBatch({
    queue: new SupabaseQueueAdapter(client),
    email: new LoggingEmailAdapter(),
    resolver: new SupabaseNotificationContentResolver(client),
    recorder: new SupabaseNotificationRecorder(client),
    jobStatus: new SupabaseJobStatusChecker(client),
    captureException: (error, context) => {
      setSentryDiagnosticContext({ job_id: context.jobId });
      Sentry.captureException(error);
    },
  });

  return NextResponse.json(result);
}
