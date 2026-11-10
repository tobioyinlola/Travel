import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

/** NIST 800-63B style: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters');

/** argon2id with the library defaults (m=19 MiB, t=2, p=1), the OWASP minimum recommendation. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Verified against when the account does not exist, so response time does not reveal which emails exist. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash('not-a-real-password-just-for-timing');
  return dummyHash;
}
