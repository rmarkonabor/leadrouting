# CLAUDE.md

Permanent project rules for the Lead Routing SaaS platform. These rules do
not expire between sessions or milestones.

## Source of truth

1. Read `docs/phase1-product-spec.md` before any major change. It defines
   scope, data model, and behavior. If a request conflicts with it, the
   spec wins — flag the conflict instead of guessing.
2. Work on only one milestone at a time, in the order defined in
   `docs/implementation-plan.md`. Do not start the next milestone until the
   current one's definition of done is met.

## Scope discipline

3. Never add a feature listed in the spec's "Explicitly Excluded Scope"
   section (calling, SMS, scheduling, marketing automation, a full CRM, a
   visual pipeline, AI routing/qualification/summaries, lead auctions,
   multi-workspace orgs, etc.), even if it seems like a natural extension.
4. Do not add Redis, BullMQ, pg-boss, Drizzle, Prisma, another
   authentication provider, or another database provider. The approved
   stack is Next.js, React, TypeScript (strict), Supabase (Postgres, Auth,
   RLS, migrations, database functions, Queues, Cron, Edge Functions when
   needed, PostGIS), Zod, Vitest, Playwright (pre-pilot), Sentry, Vercel,
   GitHub, GitHub Actions.

## Tenant isolation and security

5. Never expose Supabase secret keys to the browser. Only
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are
   client-visible; `SUPABASE_SECRET_KEY` and all other secrets are
   server-only.
6. Never trust an `organization_id` supplied by the browser (header, body,
   query param, or cookie). Resolve the active organization server-side
   from the authenticated user's verified membership in `organization_users`.
7. Enable Row Level Security on every tenant-owned table, with policies
   that re-check live membership (not cached JWT claims).
8. Scope every customer record query by `organization_id`, enforced by both
   RLS and server-side authorization — never rely on one alone.

## Database discipline

9. Keep all database schema changes in SQL migration files under
   `supabase/migrations/`. Never hand-edit the linked database schema.
10. Never modify the linked production database directly.
11. Never run destructive linked-database commands without explicit
    approval from the user.
12. Never run `supabase db reset --linked`.

## Deployment and safety

13. Never deploy to Vercel production without explicit approval.
14. Never use permission bypass mode (e.g. `--no-verify`, `--dangerously-*`
    flags) to get past a check.

## Quality gates

15. Before declaring any milestone or task complete, run formatting,
    linting, TypeScript type checking, and the relevant test suite. All
    must pass.
16. When a test fails, stop and fix the root cause. Do not weaken
    assertions, disable the test, or loosen a database constraint to make
    it pass.
17. Do not mark incomplete or partially working functionality as complete.

## Privacy

18. Never store personal lead data (names, emails, phones, addresses,
    messages, consent text, custom variable values) in application logs or
    in Sentry. Use the shared Sentry sanitizer and structured logging
    helpers in `lib/sentry` and `lib/logging` — do not log raw request or
    lead payloads elsewhere.

## Other durable practices

19. Preserve routing and assignment history — published routing versions
    and past assignment attempts are immutable once created.
20. Every queue processor and cron job must be idempotent.
21. Critical assignment operations (`route_lead`, `accept_assignment`,
    `decline_assignment`, `expire_assignment`, `reassign_lead`) run as
    single-transaction Postgres database functions, never as multi-request
    client-orchestrated flows.
22. Document architectural decisions in `docs/decisions.md` as they're made.
