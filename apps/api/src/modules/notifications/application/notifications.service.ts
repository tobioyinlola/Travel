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
  /** Payload field holding the recipient's user id (default `userId`). */
  recipient?: string;
  vars?: (p: Record<string, unknown>) => Record<string, string>;
};

const decision = (p: Record<string, unknown>) => ({
  tripId: String(p.tripId),
  title: String(p.tripTitle),
  decidedBy: String(p.decidedByName),
  note: String(p.note ?? ''),
});

const money = (v: unknown) =>
  Money.fromJSON(v as { amountMinor: string; currency: string }).toString();
const hotelsText = (p: Record<string, unknown>) =>
  ((p.lines as Array<Record<string, string>> | undefined) ?? [])
    .map(
      (l) =>
        `- ${l.propertyName}: ${l.checkIn} to ${l.checkOut}, confirmation ${l.confirmationCode}`,
    )
    .join('\n');

const RULES: Rule[] = [
  {
    event: 'BookingConfirmed',
    template: 'booking_confirmed_advisor',
    recipient: 'advisorUserId',
    vars: (p) => ({
      tripId: String(p.tripId),
      title: String(p.tripTitle),
      traveler: String(p.travelerName ?? 'your traveler'),
      hotels: hotelsText(p),
    }),
  },
  {
    event: 'BookingFailed',
    template: 'booking_failed_advisor',
    recipient: 'advisorUserId',
    urgent: true,
    vars: (p) => ({
      tripId: String(p.tripId),
      title: String(p.tripTitle),
      reason: String(p.reason),
    }),
  },
  {
    event: 'BookingBlocked',
    template: 'booking_blocked_advisor',
    recipient: 'advisorUserId',
    urgent: true,
    vars: (p) => ({
      tripId: String(p.tripId),
      title: String(p.tripTitle),
      reason: String(p.reason),
    }),
  },
  {
    event: 'BookingCancelled',
    template: 'booking_cancelled_advisor',
    recipient: 'advisorUserId',
    vars: (p) => ({
      tripId: String(p.tripId),
      title: String(p.tripTitle),
      penalty: money(p.penalty),
      refund: money(p.refund),
    }),
  },
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
  {
    event: 'ProposalApproved',
    template: 'proposal_approved',
    recipient: 'advisorUserId',
    vars: decision,
  },
  {
    event: 'ProposalChangesRequested',
    template: 'proposal_changes_requested',
    recipient: 'advisorUserId',
    urgent: true,
    vars: decision,
  },
  {
    event: 'ProposalDeclined',
    template: 'proposal_declined',
    recipient: 'advisorUserId',
    vars: decision,
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

    // The traveler has no account: send to the address in the event. The link is secret, so not stored.
    this.bus.subscribe<{
      proposalId: string;
      advisorName: string;
      recipientEmail: string;
      recipientName: string;
      url: string;
    }>({
      module: 'notifications',
      handler: 'notifications.sendProposal',
      event: 'ProposalSent',
      version: 1,
      handle: async (e, tx) => {
        const r = templates.proposal_sent!({
          name: e.payload.recipientName,
          advisorName: e.payload.advisorName,
          url: e.payload.url,
        });
        await this.queue(
          tx,
          e,
          'proposal_sent',
          null,
          'email',
          e.payload.recipientEmail,
          r.subject,
          r.text,
          true,
          true,
        );
      },
    });

    // The traveler has no account: write to the address given at checkout, carried on the event.
    const toTraveler: Array<
      [string, string, (p: Record<string, unknown>) => Record<string, string>]
    > = [
      [
        'BookingConfirmed',
        'booking_confirmed_traveler',
        (p) => ({ title: String(p.tripTitle), hotels: hotelsText(p) }),
      ],
      [
        'BookingFailed',
        'booking_failed_traveler',
        (p) => ({ title: String(p.tripTitle), reason: String(p.reason) }),
      ],
      [
        'BookingCancelled',
        'booking_cancelled_traveler',
        (p) => ({
          title: String(p.tripTitle),
          penalty: money(p.penalty),
          refund: money(p.refund),
          zero: money({ amountMinor: '0', currency: (p.penalty as { currency: string }).currency }),
        }),
      ],
    ];
    for (const [event, template, vars] of toTraveler) {
      this.bus.subscribe({
        module: 'notifications',
        handler: `notifications.${template}`,
        event,
        version: 1,
        handle: async (e, tx) => {
          const p = e.payload;
          if (!p.travelerEmail) return; // the booking never got as far as traveler details
          const r = templates[template]!({
            name: String(p.travelerName ?? 'there'),
            ...vars(p),
          });
          await this.queue(
            tx,
            e,
            template,
            null,
            'email',
            String(p.travelerEmail),
            r.subject,
            r.text,
            false,
            true,
          );
        },
      });
    }

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
    const userId = String(e.payload[rule.recipient ?? 'userId']);
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
    userId: string | null,
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
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
