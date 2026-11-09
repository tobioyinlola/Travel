import type { Tx } from '../../../platform/db/tx.js';

/** ARCH IdentityVerificationPort: KYC and sanctions screening. We store only the result and reference. */
export interface IdentityVerificationPort {
  readonly provider: string;
  startVerification(input: {
    advisorId: string;
    legalName: string;
    country: string;
  }): Promise<{ reference: string; redirectUrl: string }>;
}

/** ARCH SignaturePort: contractor agreement e-signature. */
export interface SignaturePort {
  readonly provider: string;
  createEnvelope(input: {
    advisorId: string;
    signerName: string;
    signerEmail: string | null;
    templateVersion: string;
  }): Promise<{ envelopeRef: string; signingUrl: string }>;
}

export const IDENTITY_VERIFICATION_PORT = Symbol('IdentityVerificationPort');
export const SIGNATURE_PORT = Symbol('SignaturePort');

/** Results arriving from provider webhooks, translated into our model by each adapter. */
export interface KycResult {
  provider: string;
  reference: string;
  outcome: 'passed' | 'failed';
}

export interface SignatureResult {
  envelopeRef: string;
  outcome: 'signed' | 'declined';
  documentRef: string | null;
  signedAt: string | null;
}

export interface ProviderResultSink {
  applyKycResult(result: KycResult, tx: Tx): Promise<void>;
  applySignatureResult(result: SignatureResult, tx: Tx): Promise<void>;
}

/** Current contractor agreement template. Bump when legal changes the text. */
export const AGREEMENT_VERSION = '2026-11-v1';
