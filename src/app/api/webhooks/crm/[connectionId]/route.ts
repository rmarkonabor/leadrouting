import { NextRequest, NextResponse } from "next/server";
import { createAnonSupabaseClient } from "@/lib/supabase/anon";
import { HttpCrmAdapter } from "@/modules/integrations/http-crm-adapter";
import { decryptSecret } from "@/lib/crypto/secret-box";

/**
 * Public inbound endpoint for a connected CRM pushing lead status changes
 * back to us (spec §42 item 7: "receive selected lead status changes").
 * This is the second pre-auth request path in the codebase alongside
 * `POST /api/v1/intake/[sourceToken]` (docs/decisions.md ADR-011) — it must
 * never import the service-role client (ADR-022, enforced by the ESLint
 * import-boundary rule); instead it uses the same session-less anon client
 * plus two narrow SECURITY DEFINER functions
 * (`get_connection_for_inbound_webhook`, `apply_inbound_crm_status_change`)
 * that do the elevated read/write, mirroring `resolve_lead_source`/
 * `record_lead_submission`. Real authorization is the adapter's own
 * signature verification inside `handleWebhook`, using the connection's
 * stored secret — nothing here re-derives that check.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const supabase = createAnonSupabaseClient();

  const { data: connections, error } = await supabase.rpc(
    "get_connection_for_inbound_webhook",
    {
      p_connection_id: connectionId,
    },
  );

  const connection = connections?.[0];
  if (error || !connection) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const credentials = connection.credentials_encrypted
    ? (JSON.parse(decryptSecret(connection.credentials_encrypted)) as Record<
        string,
        unknown
      >)
    : {};

  const adapter = new HttpCrmAdapter();
  await adapter.connect(connection.settings, credentials);

  const event = await adapter.handleWebhook({ headers, rawBody });
  if (!event) {
    return NextResponse.json({ error: "invalid_signature_or_payload" }, { status: 401 });
  }

  const { data: result, error: applyError } = await supabase.rpc(
    "apply_inbound_crm_status_change",
    {
      p_connection_id: connectionId,
      p_external_record_id: event.externalRecordId,
      p_crm_status: event.crmStatus,
    },
  );

  if (applyError) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result });
}
