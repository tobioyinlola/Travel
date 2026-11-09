import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../platform/http/auth.js';
import { WebhookInbox } from '../../../platform/webhooks/webhooks.js';
import { FAKE_ESIGN, FAKE_KYC, fakeWebhookRequest } from '../infrastructure/fake-providers.js';

/**
 * Development only (PROVIDERS_MODE=fake): stands in for the provider's hosted page. "Completing" the check
 * makes the fake provider send its signed webhook through the real inbox pipeline.
 */
@ApiTags('dev')
@Controller({ path: 'dev', version: '1' })
@Public()
export class FakeProvidersController {
  constructor(private readonly inbox: WebhookInbox) {}

  @Post('fake-kyc/:reference/:outcome')
  @HttpCode(HttpStatus.ACCEPTED)
  async kyc(@Param('reference') reference: string, @Param('outcome') outcome: string) {
    const { body, headers } = fakeWebhookRequest({
      reference,
      outcome: outcome === 'fail' ? 'failed' : 'passed',
    });
    await this.inbox.receive(FAKE_KYC, headers, Buffer.from(body));
    return { sent: true };
  }

  @Post('fake-signature/:envelopeRef/:outcome')
  @HttpCode(HttpStatus.ACCEPTED)
  async sign(@Param('envelopeRef') envelopeRef: string, @Param('outcome') outcome: string) {
    const { body, headers } = fakeWebhookRequest({
      envelopeRef,
      outcome: outcome === 'decline' ? 'declined' : 'signed',
      signedAt: new Date().toISOString(),
    });
    await this.inbox.receive(FAKE_ESIGN, headers, Buffer.from(body));
    return { sent: true };
  }
}
