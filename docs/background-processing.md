# Background Processing

Source: `docs/phase1-product-spec.md` §40–§41, §42 (retries), §43
(webhook retries). Uses Supabase Queues (pgmq) and Supabase Cron
exclusively — no Redis, BullMQ, or pg-boss.

## 1. Queues

| Queue                      | Producer                                                                          | Consumer                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assignment_notifications` | `route_lead`, `reassign_lead` DB functions                                        | notifications module consumer                            | Send email + in-app notification for a new/changed assignment                                                                                                                                                                                                                                                                                                                                                                   |
| `crm_sync`                 | `leads`/`assignments`/`lead_status_history` AFTER triggers (Milestone 8, ADR-052) | integrations module consumer (`processCrmSyncBatch`)     | Create/update CRM contact, sync owner, sync status, add explanation note                                                                                                                                                                                                                                                                                                                                                        |
| `outbound_webhooks`        | same AFTER triggers as `crm_sync`                                                 | webhooks module consumer (`processOutboundWebhookBatch`) | Deliver signed webhook payloads for subscribed events                                                                                                                                                                                                                                                                                                                                                                           |
| `integration_retries`      | crm_sync / outbound_webhooks failure paths                                        | integrations/webhooks consumers                          | **Not a literal pgmq queue** (ADR-054, Milestone 8) — `fail_integration_job` archives the failed message and sets `next_retry_at` directly on the `integration_jobs` row; `drain_integration_retries(queue_name)` (wrapped per-queue for Cron) re-sends a fresh message into the row's own `crm_sync`/`outbound_webhooks` queue once due. Realized entirely against the shared `integration_jobs` ledger, not a separate queue. |
| `csv_imports`              | imports module (`startImport`)                                                    | imports module consumer                                  | Process a confirmed bulk import transactionally, row by row or in one transaction per spec's "transactional import" requirement                                                                                                                                                                                                                                                                                                 |
| `operational_alerts`       | Cron health checks, integration failure thresholds                                | notifications module consumer                            | Notify admins of CRM sync failures / webhook retries exhausted                                                                                                                                                                                                                                                                                                                                                                  |

Every message carries a `dedupe_key` unique per `(queue_name, dedupe_key)`
(see `integration_jobs` in `docs/database-schema.md`) so redelivery by the
queue never double-processes: consumers `INSERT ... ON CONFLICT DO NOTHING`
into the job table before acting, and no side effect runs unless the
insert succeeded.

## 2. Cron jobs

| Job                              | Schedule (indicative) | Action                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expire-assignments`             | every 1 minute        | Find `assignments` past `acceptance_deadline_at` still `pending/notified/viewed`; call `expire_assignment` for each, which triggers `reassign_lead`                                                                                                                                                                                                                                                         |
| `send-expiration-warnings`       | every 1 minute        | Find assignments approaching their deadline (e.g. 80% elapsed) not yet warned; enqueue `assignment_notifications`                                                                                                                                                                                                                                                                                           |
| `drain-crm-sync-retries`         | every 5 minutes       | Pull `integration_jobs` in `retrying` with `next_retry_at <= now()` for `crm_sync`, re-enqueue                                                                                                                                                                                                                                                                                                              |
| `drain-webhook-retries`          | every 5 minutes       | Same, for `outbound_webhooks`, following the retry schedule in spec §43 (1m, 5m, 30m, 2h, 12h)                                                                                                                                                                                                                                                                                                              |
| `refresh-routing-health-metrics` | every 5 minutes       | Recompute `routing_health_metrics` bucket rows from source tables                                                                                                                                                                                                                                                                                                                                           |
| `dead-letter-sweep`              | n/a (Milestone 8)     | Not a separate Cron job: `fail_integration_job` moves a job straight to `dead_letter` inline, the moment its attempt count reaches the max — there is nothing left for a periodic sweep to find. Raising an `operational_alerts` message on dead-letter is deferred (not in the Milestone 8 kickoff's 13 requirements); Sentry captures unexpected processor failures in the meantime, same as Milestone 6. |

All Cron jobs are implemented as thin wrappers that call a Postgres
database function or an Edge Function; the actual logic (locking,
idempotency) lives in the function, not in the Cron trigger itself, so
manual/backfill invocation behaves identically to the scheduled one.

## 3. Job status lifecycle

Per spec §41: `queued -> processing -> completed`, or `queued ->
processing -> failed -> retrying -> (processing again) -> completed |
dead_letter`, with `cancelled` reachable from `queued`/`retrying` when an
admin manually cancels (e.g. disabling an integration). Status transitions
are written by the consumer inside the same transaction as the side effect
it performs, so a crash between "mark completed" and "do the work" is
impossible — the write of the result and the status update are one
statement/transaction.

## 4. Idempotency requirements (per spec §41: "every queue message and scheduled process must be idempotent")

- Notification sends: keyed by `(assignment_id, notification_event_type)`
  — a resend of the same queue message does not create a duplicate
  `notifications` row (unique constraint) and does not resend an email
  already marked sent.
- CRM sync: keyed by `(lead_id, integration_connection_id, sync_type)`;
  `external_record_links` prevents duplicate CRM contact creation on retry
  (spec §42 "prevent duplicate CRM contacts").
- Webhook delivery: keyed by `(webhook_endpoint_id, event_id)` — retries
  reuse the same `event_id`, and the endpoint's own replay protection plus
  our `webhook_deliveries` unique constraint prevent duplicate delivery
  records; the HTTP delivery itself is retried but the logical event is
  only ever "delivered" once (or the receiver is expected to dedupe on
  `event_id`, which we document for customers in webhook docs).
- CSV import: the whole confirmed import runs inside a single Postgres
  transaction per spec §14 ("transactional import"); a retried
  `csv_imports` message is a no-op if `import_jobs.status` is already
  `completed`.
- Cron sweeps: each iteration operates on rows matched by a `WHERE`
  clause on current state (e.g. `status = 'pending' AND
acceptance_deadline_at < now()`), so running the sweep twice in overlap
  is safe — the second run simply matches zero rows for anything the
  first run already transitioned.

## 5. Failure isolation

Per spec §40 ("failures must not roll back a successful assignment
transaction"): notification, CRM sync, and webhook delivery are always
queued as a side effect _after_ the routing/assignment transaction
commits, never inside it. A notification failure updates `integration_jobs`/
`webhook_deliveries` status and may raise an `operational_alerts` message,
but never touches `assignments` or `leads` state.
