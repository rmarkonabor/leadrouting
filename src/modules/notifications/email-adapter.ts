/**
 * Email sending is behind a swappable adapter because no email service
 * provider is part of the approved stack (CLAUDE.md's technology list) —
 * adding one (Resend/SendGrid/SES/etc.) needs an explicit decision before
 * this milestone, the same way Supabase Vault was flagged as an open
 * decision for CRM credential encryption (docs/decisions.md ADR-003). See
 * ADR-041 for the full rationale.
 *
 * `LoggingEmailAdapter` is the safe production default until that decision
 * is made: it records the send (via structured logging, never raw lead
 * content) instead of contacting any external network service.
 * `TestEmailAdapter` is required reading for every test in this milestone
 * — the kickoff explicitly forbids sending real customer email during
 * automated tests.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

export class LoggingEmailAdapter implements EmailAdapter {
  async send(_message: EmailMessage): Promise<void> {
    // Deliberately does not log `to`/`subject`/`body` — those may contain
    // lead-derived personal data (CLAUDE.md rule 18). Only the fact that a
    // send was attempted is recorded; the notification's own database row
    // (written separately) is the source of truth for what was sent.
    console.info("[email-adapter] send attempted (no ESP configured — logging only)");
    await Promise.resolve();
  }
}

export class TestEmailAdapter implements EmailAdapter {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    await Promise.resolve();
  }
}
