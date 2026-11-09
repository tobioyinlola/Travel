import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@atp/contracts';
import { Money, newId } from '../../shared-kernel/index.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { MESSAGING_PORT, type MessagingPort } from './messaging.port.js';
import { templates } from './templates.js';

interface Recipient {
  user_id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
}

interface SendJob {
  messageId: string;
  /** Present only for sensitive templates, whose body is not stored. */
  text?: string;
}

/** Event -> message rules. Each rule: which template, for whom, with which variables. */
type Rule = {
  event: string;
  template: string;
  urgent?: boolean;
  vars?: (p: Record<string, unknown>) => Record<string, string>;
};

const RULES: Rule[] = [
  { event: 'AdvisorApplicationSubmitted', template: 'application_received' },
  {
    event: 'AdvisorInformationRequested',
    template: 'application_info_requested',
    vars: (p) => ({ note: String(p.note) }),
  },
  { event: 'AdvisorApplicationRejected', template: 'application_rejected' },
  { event: 'AdvisorApplicationAccepted', template: 'application_accepted' },
  { event: 'AdvisorApproved', template: 'advisor_approved' },
  {
    event: 'MembershipInvoicePaid',
    template: 'membership_receipt',
    vars: (p) => ({
      total: Money.fromJSON(p.total as { amountMinor: string; currency: string }).toString(),
    }),
  },
  {
    event: 'MembershipPaymentFailed',
    template: 'membership_payment_failed',
    urgent: true,
    vars: (p) => ({ reason: String(p.reason) }),
  },
  {
    event: 'MembershipCancelled',
    template: 'membership_cancelled',
    vars: (p) => ({ endsAt: String(p.endsAt).slice(0, 10) }),
  },
];

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.register<SendJob>({
      name: 'notifications.send-urgent',
      module: 'notifications',
      queue: 'critical',
      handle: (j) => this.deliver(j),
    });
    this.jobs.register<SendJob>({
      name: 'notifications.send',
      module: 'notifications',
      queue: 'default',
      handle: (j) => this.deliver(j),
    });

    this.bus.subscribe<{
      userId: string;
      email: string | null;
      phone: string | null;
      displayName: string | null;
    }>({
      module: 'notifications',
      handler: 'notifications.projectRecipient',
      event: 'UserRegistered',
      version: 1,
      queue: 'critical', // a verification code may be waiting on this row
      handle: async (e, tx) => {
        await tx.query(
          `INSERT INTO notifications.recipients (user_id, email, phone, display_name) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone,
             display_name = EXCLUDED.display_name, updated_at = now()`,
          [e.payload.userId, e.payload.email, e.payload.phone, e.payload.displayName],
        );
      },
    });

    this.bus.subscribe<{
      userId: string;
      channel: 'email' | 'sms';
      destination: string;
      code: string;
    }>({
      module: 'notifications',
      handler: 'notifications.sendVerificationCode',
      event: 'VerificationCodeIssued',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        const r = templates.verification_code!({ code: e.payload.code });
        await this.queue(
          tx,
          e,
          'verification_code',
          e.payload.userId,
          e.payload.channel,
          e.payload.destination,
          r.subject,
          r.text,
          true,
          true,
        );
      },
    });

    for (const rule of RULES) {
      this.bus.subscribe({
        module: 'notifications',
        handler: `notifications.${rule.template}`,
        event: rule.event,
        version: 1,
        handle: (e, tx) => this.applyRule(rule, e, tx),
      });
    }
  }

  private async applyRule(rule: Rule, e: EventEnvelope, tx: Tx): Promise<void> {
    const userId = String(e.payload.userId);
    const [r] = await tx.query<Recipient>(
      'SELECT * FROM notifications.recipients WHERE user_id = $1',
      [userId],
    );
    if (!r) throw new Error(`No recipient for user ${userId} yet`); // retried: the projection may lag
    const channel = r.email ? 'email' : 'sms';
    const to = (r.email ?? r.phone) as string;
    const vars = {
      name: r.display_name ?? 'there',
      webBaseUrl: this.config.WEB_BASE_URL,
      ...(rule.vars?.(e.payload) ?? {}),
    };
    const rendered = templates[rule.template]!(vars);
    await this.queue(
      tx,
      e,
      rule.template,
      userId,
      channel,
      to,
      rendered.subject,
      rendered.text,
      Boolean(rendered.sensitive),
      Boolean(rule.urgent),
    );
  }

  private async queue(
    tx: Tx,
    e: EventEnvelope,
    template: string,
    userId: string,
    channel: 'email' | 'sms',
    to: string,
    subject: string,
    text: string,
    sensitive: boolean,
    urgent: boolean,
  ): Promise<void> {
    const id = newId();
    const inserted = await tx.query(
      `INSERT INTO notifications.messages (id, event_id, template, user_id, channel, destination, subject, body_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (event_id, template, user_id) DO NOTHING RETURNING id`,
      [id, e.id, template, userId, channel, to, subject, sensitive ? '[redacted]' : text],
    );
    if (inserted.length === 0) return; // FR-NTF-05: duplicate suppressed
    const job: SendJob = sensitive ? { messageId: id, text } : { messageId: id };
    await tx.enqueue(
      urgent || sensitive ? 'notifications.send-urgent' : 'notifications.send',
      job,
      { jobKey: `msg:${id}` },
    );
  }

  /** Sends outside any transaction, then records the outcome. Retries come from the job runner. */
  private async deliver(job: SendJob): Promise<void> {
    const [m] = await this.db.read<{
      channel: 'email' | 'sms';
      destination: string;
      subject: string;
      body_text: string;
      status: string;
    }>(
      'notifications',
      'SELECT channel, destination, subject, body_text, status FROM notifications.messages WHERE id = $1',
      [job.messageId],
    );
    if (!m || m.status === 'sent') return;
    const { providerRef } = await this.messaging.send({
      channel: m.channel,
      to: m.destination,
      subject: m.subject,
      text: job.text ?? m.body_text,
    });
    await this.db.transaction('notifications', (tx) =>
      tx.query(
        `UPDATE notifications.messages SET status = 'sent', provider_ref = $2, sent_at = now() WHERE id = $1`,
        [job.messageId, providerRef],
      ),
    );
  }
}
