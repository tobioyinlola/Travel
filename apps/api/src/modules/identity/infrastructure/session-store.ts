import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { AuthUser, Role } from '../../../platform/http/auth.js';

interface StoredSession {
  userId: string;
  role: Role;
  mfaVerified: boolean;
  createdAt: string;
}

const sessionKey = (id: string) => `sess:${id}`;
const userSessionsKey = (userId: string) => `usess:${userId}`;

/**
 * Server-side sessions in Redis (ARCH stack: "Redis - sessions"). The cookie holds a random token; Redis
 * holds only its SHA-256, so a Redis dump cannot be replayed as cookies.
 */
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  private async ready(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  static idOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, role: Role, mfaVerified: boolean): Promise<string> {
    await this.ready();
    const token = randomBytes(32).toString('base64url');
    const id = SessionStore.idOf(token);
    const value: StoredSession = { userId, role, mfaVerified, createdAt: new Date().toISOString() };
    await this.redis
      .multi()
      .set(sessionKey(id), JSON.stringify(value), 'EX', this.ttlSeconds)
      .sadd(userSessionsKey(userId), id)
      .expire(userSessionsKey(userId), this.ttlSeconds)
      .exec();
    return token;
  }

  async resolve(token: string): Promise<AuthUser | null> {
    await this.ready();
    const id = SessionStore.idOf(token);
    const raw = await this.redis.get(sessionKey(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    return { id: s.userId, role: s.role, mfaVerified: s.mfaVerified, sessionId: id };
  }

  async destroy(token: string): Promise<void> {
    await this.ready();
    const id = SessionStore.idOf(token);
    const raw = await this.redis.get(sessionKey(id));
    await this.redis.del(sessionKey(id));
    if (raw) await this.redis.srem(userSessionsKey((JSON.parse(raw) as StoredSession).userId), id);
  }

  /** Sign out everywhere (suspension, password or role change). */
  async destroyAllForUser(userId: string): Promise<void> {
    await this.ready();
    const ids = await this.redis.smembers(userSessionsKey(userId));
    if (ids.length > 0) await this.redis.del(...ids.map(sessionKey));
    await this.redis.del(userSessionsKey(userId));
  }
}
