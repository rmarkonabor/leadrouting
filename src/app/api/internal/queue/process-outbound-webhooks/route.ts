import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serverEnv } from "@/lib/env/server";
import { setSentryDiagnosticContext } from "@/lib/sentry/diagnostics";
import { processOutboundWebhookBatch } from "@/modules/webhooks/process-outbound-webhooks";
import { SupabaseWebhookRepository } from "@/modules/webhooks/webhook-repository";
import { SupabaseIntegrationQueueAdapter } from "@/lib/queue/integration-queue-adapter";
import { SupabaseJobStatusChecker } from "@/lib/queue/job-status";
import { FetchHttpDeliverer } from "@/modules/webhooks/http-deliverer";

// Internal, invoked by Supabase Cron's pg_net HTTP call (see the
// Milestone 8 migration's cron.schedule block) — same pattern and
// authorization as process-assignment-notifications (Milestone 6).

export async function POST(request: NextRequest) {
  if (!serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (providedSecret !== serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const client = createServiceRoleClient();

  const result = await processOutboundWebhookBatch({
    repository: new SupabaseWebhookRepository(client),
    queue: new SupabaseIntegrationQueueAdapter(client, "outbound_webhooks"),
    jobStatus: new SupabaseJobStatusChecker(client),
    deliverer: new FetchHttpDeliverer(),
    captureException: (error, context) => {
      setSentryDiagnosticContext({ job_id: context.jobId });
      Sentry.captureException(error);
    },
  });

  return NextResponse.json(result);
}
