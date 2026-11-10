import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for secrets and tax identifiers (ARCH security: "field-level encryption for tax
 * identifiers"). AES-256-GCM, random 96-bit IV, format `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * The key comes from the managed secret store in production (FIELD_ENCRYPTION_KEY, 32 bytes base64).
 */
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32)
      throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(token: string): string {
    const [version, iv, tag, ct] = token.split('.');
    if (version !== 'v1' || !iv || !tag || ct === undefined)
      throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
