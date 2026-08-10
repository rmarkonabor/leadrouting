import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serverEnv } from "@/lib/env/server";
import { setSentryDiagnosticContext } from "@/lib/sentry/diagnostics";
import { processCrmSyncBatch } from "@/modules/integrations/process-crm-sync";
import { SupabaseCrmSyncRepository } from "@/modules/integrations/crm-sync-repository";
import { SupabaseIntegrationQueueAdapter } from "@/lib/queue/integration-queue-adapter";
import { SupabaseJobStatusChecker } from "@/lib/queue/job-status";
import { HttpCrmAdapter } from "@/modules/integrations/http-crm-adapter";

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

  const result = await processCrmSyncBatch({
    repository: new SupabaseCrmSyncRepository(client),
    queue: new SupabaseIntegrationQueueAdapter(client, "crm_sync"),
    jobStatus: new SupabaseJobStatusChecker(client),
    createAdapter: () => new HttpCrmAdapter(),
    captureException: (error, context) => {
      setSentryDiagnosticContext({ job_id: context.jobId });
      Sentry.captureException(error);
    },
  });

  return NextResponse.json(result);
}
