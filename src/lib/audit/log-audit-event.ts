import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logger } from "@/lib/logging/logger";

export interface AuditEventInput {
  organizationId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: unknown;
  afterData?: unknown;
}

/**
 * Inserts one audit_logs row (docs/security-model.md §8, spec §46). Called
 * by module functions immediately after (or as part of) the audited action's
 * own write. Uses the caller's own RLS-scoped client — never the
 * service-role client — so the actor is always verifiably the real caller,
 * matching the audit_logs_insert_self_action RLS policy.
 *
 * `beforeData`/`afterData` must never contain personal lead data (not
 * applicable to this milestone, which only audits org/user/team/import
 * administrative changes — none of which are lead PII) — see CLAUDE.md
 * rule 18.
 */
export async function logAuditEvent(
  supabase: SupabaseClient<Database>,
  input: AuditEventInput,
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: input.organizationId,
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before_data: input.beforeData ?? null,
    after_data: input.afterData ?? null,
  });

  if (error) {
    // Never let a failed audit-log write silently swallow itself — but also
    // never let it roll back or block the action it's auditing (the action's
    // own write has already committed by the time this runs).
    logger.error("audit_log_insert_failed", {
      organization_id: input.organizationId,
      actor_user_id: input.actorUserId,
      error_code: error.code,
    });
  }
}
