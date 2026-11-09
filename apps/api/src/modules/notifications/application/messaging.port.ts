/** ARCH MessagingPort: email now, SMS and push in V1. */
export interface OutboundMessage {
  channel: 'email' | 'sms';
  to: string;
  subject: string;
  text: string;
}

export interface MessagingPort {
  send(message: OutboundMessage): Promise<{ providerRef: string }>;
}

export const MESSAGING_PORT = Symbol('MessagingPort');
