import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { VerifiedWebhook, WebhookProvider } from '../../../platform/webhooks/webhooks.js';
import type {
  IdentityVerificationPort,
  ProviderResultSink,
  SignaturePort,
} from '../application/ports.js';

/**
 * In-process stand-ins for the KYC and e-signature providers (Sprints 1-9; real adapters in Sprint 10).
 * They behave like the real thing where it matters: results arrive later, as HMAC-signed webhooks, through
 * the same inbox pipeline (verify -> store -> de-duplicate -> process async).
 */
export const FAKE_KYC = 'fake-kyc';
export const FAKE_ESIGN = 'fake-esign';
const SECRET = 'fake-provider-signing-secret';

export function signFakeWebhook(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function verifySignature(
  headers: Record<string, string | string[] | undefined>,
  raw: Buffer,
): unknown {
  const sig = headers['x-fake-signature'];
  if (typeof sig !== 'string') throw new Error('missing signature');
  const expected = Buffer.from(signFakeWebhook(raw.toString('utf8')));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    throw new Error('bad signature');
  return JSON.parse(raw.toString('utf8'));
}

export class FakeKycProvider implements IdentityVerificationPort {
  readonly provider = FAKE_KYC;
  constructor(private readonly webBaseUrl: string) {}

  async startVerification(input: {
    advisorId: string;
  }): Promise<{ reference: string; redirectUrl: string }> {
    const reference = `kyc_${randomUUID()}`;
    return {
      reference,
      redirectUrl: `${this.webBaseUrl}/dev/fake-kyc/${reference}?advisor=${input.advisorId}`,
    };
  }
}

export class FakeSignatureProvider implements SignaturePort {
  readonly provider = FAKE_ESIGN;
  constructor(private readonly webBaseUrl: string) {}

  async createEnvelope(): Promise<{ envelopeRef: string; signingUrl: string }> {
    const envelopeRef = `env_${randomUUID()}`;
    return { envelopeRef, signingUrl: `${this.webBaseUrl}/dev/fake-signature/${envelopeRef}` };
  }
}

export function fakeKycWebhook(sink: ProviderResultSink): WebhookProvider {
  return {
    name: FAKE_KYC,
    module: 'identity',
    verify(headers, raw): VerifiedWebhook {
      const body = verifySignature(headers, raw) as {
        id: string;
        reference: string;
        outcome: 'passed' | 'failed';
      };
      return { eventId: body.id, type: 'verification.completed', payload: body };
    },
    handle: async (event, tx) => {
      const p = event.payload as { reference: string; outcome: 'passed' | 'failed' };
      await sink.applyKycResult(
        { provider: FAKE_KYC, reference: p.reference, outcome: p.outcome },
        tx,
      );
    },
  };
}

export function fakeEsignWebhook(sink: ProviderResultSink): WebhookProvider {
  return {
    name: FAKE_ESIGN,
    module: 'identity',
    verify(headers, raw): VerifiedWebhook {
      const body = verifySignature(headers, raw) as {
        id: string;
        envelopeRef: string;
        outcome: string;
      };
      return { eventId: body.id, type: `envelope.${body.outcome}`, payload: body };
    },
    handle: async (event, tx) => {
      const p = event.payload as {
        envelopeRef: string;
        outcome: 'signed' | 'declined';
        signedAt: string;
      };
      await sink.applySignatureResult(
        {
          envelopeRef: p.envelopeRef,
          outcome: p.outcome,
          documentRef: p.outcome === 'signed' ? `fake-doc/${p.envelopeRef}.pdf` : null,
          signedAt: p.outcome === 'signed' ? p.signedAt : null,
        },
        tx,
      );
    },
  };
}

/** Builds the body + headers a fake provider would POST to /webhooks/<name>. */
export function fakeWebhookRequest(payload: Record<string, unknown>): {
  body: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, ...payload });
  return {
    body,
    headers: { 'content-type': 'application/json', 'x-fake-signature': signFakeWebhook(body) },
  };
}
