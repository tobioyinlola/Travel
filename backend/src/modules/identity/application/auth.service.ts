import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';
import QRCode from 'qrcode';
import { newId } from '../../shared-kernel/index.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { MFA_REQUIRED_ROLES, type Role } from '../../../platform/http/auth.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { FieldCrypto } from '../../../platform/security/field-crypto.js';
import { REDIS } from '../../../platform/tokens.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../domain/password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../domain/totp.js';
import { LoginThrottle } from '../infrastructure/login-throttle.js';
import { SessionStore } from '../infrastructure/session-store.js';

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  password_hash: string;
  role: Role;
  status: 'pending_verification' | 'active' | 'disabled';
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  mfa_secret_enc: string | null;
  mfa_enabled_at: Date | null;
}

export interface Me {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  /** What the client should do next: verify contact, enrol MFA, pass the MFA challenge, or nothing. */
  next: 'verify_contact' | 'mfa_enroll' | 'mfa_challenge' | null;
}

const problem = (
  status: HttpStatus,
  slug: string,
  title: string,
  detail?: string,
  ext?: Record<string, unknown>,
) => new ProblemException(status, problemType(slug), title, detail, ext);

const hashCode = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

@Injectable()
export class AuthService {
  readonly sessions: SessionStore;
  private readonly throttle: LoginThrottle;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
    private readonly crypto: FieldCrypto,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.sessions = new SessionStore(redis, config.SESSION_TTL_HOURS * 3600);
    this.throttle = new LoginThrottle(redis);
  }

  // ---------- Password reset ----------

  /**
   * Emails a single-use link. The answer is the same whether or not the account exists, so this cannot be used to find
   * out who has an account. Limited per address and per IP. A reset never switches MFA off: the person must still
   * pass the second factor to sign in afterwards.
   */
  async requestPasswordReset(identifier: string, ip: string): Promise<void> {
    if (!(await this.throttle.allow(`pwreset:ip:${ip}`, 20, 3600)))
      throw problem(HttpStatus.TOO_MANY_REQUESTS, 'rate-limited', 'Too many requests');
    if (!(await this.throttle.allow(`pwreset:acct:${identifier.toLowerCase()}`, 3, 3600))) return;
    const [user] = await this.db.read<UserRow>(
      'identity',
      'SELECT * FROM identity.users WHERE email = $1',
      [identifier],
    );
    if (!user || !user.email || user.status === 'disabled') return;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await this.db.transaction('identity', async (tx) => {
      await tx.query(
        `UPDATE identity.password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
      );
      await tx.query(
        `INSERT INTO identity.password_resets (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [newId(), user.id, SessionStore.idOf(token), expiresAt],
      );
      await tx.publish({
        type: 'PasswordResetRequested',
        version: 1,
        payload: {
          userId: user.id,
          email: user.email,
          displayName: user.display_name,
          token,
          expiresAt: expiresAt.toISOString(),
        },
      });
      await this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        module: 'identity',
        metadata: { ip },
      });
    });
  }

  /** Sets the new password, retires every reset link and signs the account out everywhere. */
  async confirmPasswordReset(token: string, newPassword: string, ip: string): Promise<void> {
    if (!(await this.throttle.allow(`pwreset-confirm:ip:${ip}`, 20, 3600)))
      throw problem(HttpStatus.TOO_MANY_REQUESTS, 'rate-limited', 'Too many requests');
    const passwordHash = await hashPassword(newPassword);
    const userId = await this.db.transaction('identity', async (tx) => {
      const [row] = await tx.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM identity.password_resets
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [SessionStore.idOf(token)],
      );
      if (!row)
        throw problem(
          HttpStatus.BAD_REQUEST,
          'reset-invalid',
          'This reset link is invalid or has expired',
          'Request a new one.',
        );
      await tx.query(
        `UPDATE identity.password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [row.user_id],
      );
      await tx.query(
        `UPDATE identity.users SET password_hash = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
        [row.user_id, passwordHash],
      );
      await tx.publish({ type: 'PasswordChanged', version: 1, payload: { userId: row.user_id } });
      await this.audit.record({
        actorType: 'user',
        actorId: row.user_id,
        action: 'auth.password_reset_completed',
        entityType: 'user',
        entityId: row.user_id,
        module: 'identity',
        metadata: { ip },
      });
      return row.user_id;
    });
    await this.throttle.reset('login', userId);
    await this.sessions.destroyAllForUser(userId);
  }

  // ---------- Registration and contact verification (FR-AUTH-01) ----------

  async register(input: {
    email?: string;
    phone?: string;
    password: string;
    displayName?: string;
  }): Promise<{
    userId: string;
    channel: 'email' | 'sms';
  }> {
    const passwordHash = await hashPassword(input.password);
    const userId = newId();
    const channel = input.email ? 'email' : 'sms';
    try {
      await this.db.transaction('identity', async (tx) => {
        await tx.query(
          `INSERT INTO identity.users (id, email, phone, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, 'advisor')`,
          [
            userId,
            input.email ?? null,
            input.phone ?? null,
            input.displayName ?? null,
            passwordHash,
          ],
        );
        await tx.publish({
          type: 'UserRegistered',
          version: 1,
          payload: {
            userId,
            role: 'advisor',
            email: input.email ?? null,
            phone: input.phone ?? null,
            displayName: input.displayName ?? null,
          },
        });
        await this.audit.record({
          actorType: 'user',
          actorId: userId,
          action: 'user.registered',
          entityType: 'user',
          entityId: userId,
          module: 'identity',
          after: { role: 'advisor', channel },
        });
        await this.issueCode(tx, userId, channel, (input.email ?? input.phone) as string);
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw problem(
          HttpStatus.CONFLICT,
          'account-exists',
          'An account with these details already exists',
          'Sign in instead, or reset your password.',
        );
      }
      throw e;
    }
    return { userId, channel };
  }

  private async issueCode(
    tx: Tx,
    userId: string,
    channel: 'email' | 'sms',
    destination: string,
  ): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
    await tx.query(
      `UPDATE identity.verification_codes SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId],
    );
    await tx.query(
      `INSERT INTO identity.verification_codes (id, user_id, channel, destination, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), userId, channel, destination, hashCode(userId, code), expiresAt],
    );
    await tx.publish({
      type: 'VerificationCodeIssued',
      version: 1,
      payload: { userId, channel, destination, code, expiresAt: expiresAt.toISOString() },
    });
  }

  async resendCode(userId: string): Promise<void> {
    if (!(await this.throttle.allow(`resend:${userId}`, 3, 15 * 60))) {
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate-limited',
        'Too many codes requested',
        'Try again in 15 minutes.',
      );
    }
    await this.db.transaction('identity', async (tx) => {
      const [u] = await tx.query<UserRow>('SELECT * FROM identity.users WHERE id = $1', [userId]);
      if (!u || u.status !== 'pending_verification') return; // say nothing about other accounts
      const channel = u.email ? 'email' : 'sms';
      await this.issueCode(tx, userId, channel, (u.email ?? u.phone) as string);
    });
  }

  /** Verifies the code, activates the user and returns a new (password-equivalent) session. */
  async verifyContact(userId: string, code: string): Promise<{ token: string; me: Me }> {
    const user = await this.db.transaction('identity', async (tx) => {
      const [row] = await tx.query<{
        id: string;
        code_hash: string;
        attempts: number;
        channel: string;
      }>(
        `SELECT id, code_hash, attempts, channel FROM identity.verification_codes
          WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId],
      );
      if (!row || row.attempts >= CODE_MAX_ATTEMPTS) return null;
      if (row.code_hash !== hashCode(userId, code)) {
        await tx.query(
          'UPDATE identity.verification_codes SET attempts = attempts + 1 WHERE id = $1',
          [row.id],
        );
        return null;
      }
      await tx.query('UPDATE identity.verification_codes SET consumed_at = now() WHERE id = $1', [
        row.id,
      ]);
      const column = row.channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
      const [u] = await tx.query<UserRow>(
        `UPDATE identity.users SET ${column} = now(), status = 'active', updated_at = now(), version = version + 1
          WHERE id = $1 AND status = 'pending_verification' RETURNING *`,
        [userId],
      );
      if (u) {
        await this.audit.record({
          actorType: 'user',
          actorId: userId,
          action: 'user.contact_verified',
          entityType: 'user',
          entityId: userId,
          module: 'identity',
          after: { channel: row.channel },
        });
      }
      return u ?? null;
    });
    if (!user) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        'invalid-code',
        'That code is not valid',
        'Check the code or request a new one.',
      );
    }
    const token = await this.sessions.create(user.id, user.role, false);
    return { token, me: this.toMe(user, false) };
  }

  // ---------- Login, lockout, sessions (FR-AUTH-02, ARCH security) ----------

  async login(
    identifier: string,
    password: string,
    ip: string,
  ): Promise<{ token: string; me: Me }> {
    if (await this.throttle.isLocked('login', identifier, ip)) {
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'locked-out',
        'Too many failed attempts',
        'Sign-in is paused for 15 minutes for this account.',
      );
    }
    const [user] = await this.db.read<UserRow>(
      'identity',
      'SELECT * FROM identity.users WHERE email = $1 OR phone = $1',
      [identifier],
    );
    const ok = user
      ? await verifyPassword(user.password_hash, password)
      : await verifyPassword(await dummyPasswordHash(), password).then(() => false);
    if (!user || !ok || user.status === 'disabled') {
      await this.throttle.recordFailure('login', identifier, ip);
      await this.db.transaction('identity', () =>
        this.audit.record({
          actorType: 'user',
          actorId: user?.id ?? null,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user?.id ?? 'unknown',
          module: 'identity',
          metadata: { ip },
        }),
      );
      throw problem(
        HttpStatus.UNAUTHORIZED,
        'invalid-credentials',
        'Email, phone or password is incorrect',
      );
    }
    await this.throttle.reset('login', identifier);
    const mfaVerified = !MFA_REQUIRED_ROLES.has(user.role);
    const token = await this.sessions.create(user.id, user.role, mfaVerified);
    await this.db.transaction('identity', () =>
      this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        module: 'identity',
        metadata: { ip, mfaPending: !mfaVerified },
      }),
    );
    return { token, me: this.toMe(user, mfaVerified) };
  }

  logout(token: string): Promise<void> {
    return this.sessions.destroy(token);
  }

  async me(userId: string, mfaVerified: boolean): Promise<Me> {
    const user = await this.getUser(userId);
    return this.toMe(user, mfaVerified);
  }

  private async getUser(userId: string): Promise<UserRow> {
    const [user] = await this.db.read<UserRow>(
      'identity',
      'SELECT * FROM identity.users WHERE id = $1',
      [userId],
    );
    if (!user) throw problem(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Sign in required');
    return user;
  }

  private toMe(u: UserRow, mfaVerified: boolean): Me {
    const mfaEnabled = u.mfa_enabled_at !== null;
    let next: Me['next'] = null;
    if (u.status === 'pending_verification') next = 'verify_contact';
    else if (MFA_REQUIRED_ROLES.has(u.role) && !mfaVerified)
      next = mfaEnabled ? 'mfa_challenge' : 'mfa_enroll';
    return {
      id: u.id,
      role: u.role,
      email: u.email,
      phone: u.phone,
      displayName: u.display_name,
      mfaEnabled,
      mfaVerified,
      next,
    };
  }

  // ---------- MFA: TOTP enrolment and challenge (FR-AUTH-02) ----------

  async startMfaEnrollment(
    userId: string,
  ): Promise<{ secret: string; otpauthUri: string; qrDataUrl: string }> {
    const user = await this.getUser(userId);
    if (user.mfa_enabled_at)
      throw problem(HttpStatus.CONFLICT, 'mfa-already-enabled', 'MFA is already set up');
    const secret = generateTotpSecret();
    await this.db.transaction('identity', (tx) =>
      tx.query('UPDATE identity.users SET mfa_secret_enc = $2, updated_at = now() WHERE id = $1', [
        userId,
        this.crypto.encrypt(secret),
      ]),
    );
    const uri = otpauthUri(secret, user.email ?? user.phone ?? userId);
    return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri) };
  }

  /** Confirms the first code, enables MFA, returns one-time recovery codes and an upgraded session. */
  async confirmMfaEnrollment(
    userId: string,
    oldToken: string,
    code: string,
  ): Promise<{
    token: string;
    recoveryCodes: string[];
  }> {
    const user = await this.getUser(userId);
    if (user.mfa_enabled_at)
      throw problem(HttpStatus.CONFLICT, 'mfa-already-enabled', 'MFA is already set up');
    if (!user.mfa_secret_enc)
      throw problem(HttpStatus.BAD_REQUEST, 'mfa-not-started', 'Start MFA set-up first');
    const step = verifyTotp(this.crypto.decrypt(user.mfa_secret_enc), code, new Date());
    if (step === null || !(await this.claimStep(userId, step))) {
      throw problem(HttpStatus.BAD_REQUEST, 'invalid-code', 'That code is not valid');
    }
    const recoveryCodes = Array.from({ length: RECOVERY_CODES }, () =>
      randomBytes(5).toString('hex'),
    );
    await this.db.transaction('identity', async (tx) => {
      await tx.query(
        'UPDATE identity.users SET mfa_enabled_at = now(), updated_at = now(), version = version + 1 WHERE id = $1',
        [userId],
      );
      await tx.query('DELETE FROM identity.mfa_recovery_codes WHERE user_id = $1', [userId]);
      for (const rc of recoveryCodes) {
        await tx.query(
          'INSERT INTO identity.mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
          [userId, hashCode(userId, rc)],
        );
      }
      await this.audit.record({
        actorType: 'user',
        actorId: userId,
        action: 'auth.mfa_enabled',
        entityType: 'user',
        entityId: userId,
        module: 'identity',
      });
    });
    return { token: await this.rotateSession(oldToken, user), recoveryCodes };
  }

  async passMfaChallenge(
    userId: string,
    oldToken: string,
    input: { code?: string; recoveryCode?: string },
    ip: string,
  ): Promise<string> {
    const user = await this.getUser(userId);
    if (!user.mfa_enabled_at || !user.mfa_secret_enc) {
      throw problem(HttpStatus.BAD_REQUEST, 'mfa-not-enabled', 'Set up MFA first');
    }
    if (await this.throttle.isLocked('mfa', userId, ip)) {
      throw problem(HttpStatus.TOO_MANY_REQUESTS, 'locked-out', 'Too many failed attempts');
    }
    let ok = false;
    if (input.code) {
      const step = verifyTotp(this.crypto.decrypt(user.mfa_secret_enc), input.code, new Date());
      ok = step !== null && (await this.claimStep(userId, step));
    } else if (input.recoveryCode) {
      const used = await this.db.transaction('identity', (tx) =>
        tx.query(
          `UPDATE identity.mfa_recovery_codes SET used_at = now()
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING user_id`,
          [userId, hashCode(userId, input.recoveryCode!.trim().toLowerCase())],
        ),
      );
      ok = used.length === 1;
    }
    await this.db.transaction('identity', () =>
      this.audit.record({
        actorType: 'user',
        actorId: userId,
        action: ok ? 'auth.mfa_passed' : 'auth.mfa_failed',
        entityType: 'user',
        entityId: userId,
        module: 'identity',
        metadata: { ip, method: input.code ? 'totp' : 'recovery_code' },
      }),
    );
    if (!ok) {
      await this.throttle.recordFailure('mfa', userId, ip);
      throw problem(HttpStatus.BAD_REQUEST, 'invalid-code', 'That code is not valid');
    }
    await this.throttle.reset('mfa', userId);
    return this.rotateSession(oldToken, user);
  }

  /** A TOTP step may be used once (replay protection). */
  private async claimStep(userId: string, step: number): Promise<boolean> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const key = `totp:last:${userId}`;
    const last = Number((await this.redis.get(key)) ?? -1);
    if (step <= last) return false;
    await this.redis.set(key, String(step), 'EX', 120);
    return true;
  }

  /** New session id on privilege change (session fixation defence). */
  private async rotateSession(oldToken: string, user: UserRow): Promise<string> {
    await this.sessions.destroy(oldToken);
    return this.sessions.create(user.id, user.role, true);
  }

  // ---------- Staff accounts ----------

  /** Used by the create-staff CLI. Staff are created verified; they enrol MFA at first sign-in. */
  async createStaffUser(input: {
    email: string;
    password: string;
    role: Role;
    displayName?: string;
  }): Promise<string> {
    const id = newId();
    const passwordHash = await hashPassword(input.password);
    await this.db.transaction('identity', async (tx) => {
      await tx.query(
        `INSERT INTO identity.users (id, email, display_name, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now())`,
        [id, input.email, input.displayName ?? null, passwordHash, input.role],
      );
      await tx.publish({
        type: 'UserRegistered',
        version: 1,
        payload: {
          userId: id,
          role: input.role,
          email: input.email,
          phone: null,
          displayName: input.displayName ?? null,
        },
      });
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: 'user.staff_created',
        entityType: 'user',
        entityId: id,
        module: 'identity',
        after: { role: input.role },
      });
    });
    return id;
  }
}
