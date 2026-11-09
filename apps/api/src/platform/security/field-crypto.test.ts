import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto } from './field-crypto.js';

describe('FieldCrypto', () => {
  const crypto = new FieldCrypto(randomBytes(32).toString('base64'));

  it('round-trips and never repeats ciphertext', () => {
    const a = crypto.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(crypto.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(a);
    expect(crypto.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const parts = crypto.encrypt('secret').split('.');
    parts[3] = Buffer.from('xxxxxx').toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a short key', () => {
    expect(() => new FieldCrypto(randomBytes(16).toString('base64'))).toThrow();
  });
});
