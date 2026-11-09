import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, hotp, totp, verifyTotp } from './totp.js';

// RFC 6238 appendix B test secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 9].map((c) => hotp(RFC_SECRET, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '520489',
    ]);
  });

  it('matches RFC 6238 vectors (last 6 digits)', () => {
    expect(totp(RFC_SECRET, new Date(59_000))).toBe('287082');
    expect(totp(RFC_SECRET, new Date(1111111109_000))).toBe('081804');
    expect(totp(RFC_SECRET, new Date(2000000000_000))).toBe('279037');
  });

  it('accepts one step of drift and rejects older codes', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-11-09T10:00:15Z');
    const prev = totp(secret, new Date(now.getTime() - 30_000));
    const old = totp(secret, new Date(now.getTime() - 90_000));
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, prev, now)).not.toBeNull();
    expect(verifyTotp(secret, old, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 255, 7]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});
