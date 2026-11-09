import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MessagingPort, OutboundMessage } from '../application/messaging.port.js';

/** Email over SMTP (Mailpit locally; a transactional email provider's SMTP relay in production). */
export class SmtpMessaging implements MessagingPort {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly sms: MessagingPort,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(m: OutboundMessage): Promise<{ providerRef: string }> {
    if (m.channel === 'sms') return this.sms.send(m);
    const info = await this.transporter.sendMail({
      from: this.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
    });
    return { providerRef: String(info.messageId) };
  }
}

/** Keeps messages in memory. Used in tests, and for SMS until an SMS provider is chosen (FR-NTF-03, V1). */
export class MemoryMessaging implements MessagingPort {
  readonly sent: OutboundMessage[] = [];

  async send(m: OutboundMessage): Promise<{ providerRef: string }> {
    this.sent.push(m);
    return { providerRef: `mem_${randomUUID()}` };
  }

  /** Test helper: latest 6-digit code sent to a destination. */
  lastCodeFor(to: string): string | null {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    return m?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Development without Mailpit: prints each message. Refused in production by config validation. */
export class LogMessaging implements MessagingPort {
  async send(m: OutboundMessage): Promise<{ providerRef: string }> {
    console.log(`[mail:${m.channel}] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
    return { providerRef: `log_${randomUUID()}` };
  }
}
