import type { Redis } from 'ioredis';

/**
 * Brute-force lockout (ARCH security: "brute-force lockout"): after `maxFailures` failed attempts on one
 * account, or 10x that from one IP, further attempts are refused for the lock window.
 */
export class LoginThrottle {
  constructor(
    private readonly redis: Redis,
    private readonly maxFailures = 5,
    private readonly windowSeconds = 15 * 60,
  ) {}

  private async ready(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  private keys(scope: string, account: string, ip: string): [string, string] {
    return [`lf:${scope}:acct:${account.toLowerCase()}`, `lf:${scope}:ip:${ip}`];
  }

  async isLocked(scope: string, account: string, ip: string): Promise<boolean> {
    await this.ready();
    const [a, i] = this.keys(scope, account, ip);
    const [acct, byIp] = await this.redis.mget(a, i);
    return Number(acct ?? 0) >= this.maxFailures || Number(byIp ?? 0) >= this.maxFailures * 10;
  }

  async recordFailure(scope: string, account: string, ip: string): Promise<void> {
    await this.ready();
    const [a, i] = this.keys(scope, account, ip);
    await this.redis
      .multi()
      .incr(a)
      .expire(a, this.windowSeconds)
      .incr(i)
      .expire(i, this.windowSeconds)
      .exec();
  }

  async reset(scope: string, account: string): Promise<void> {
    await this.ready();
    await this.redis.del(`lf:${scope}:acct:${account.toLowerCase()}`);
  }

  /** Simple fixed-window limiter for resend endpoints. Returns false when over the limit. */
  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    await this.ready();
    const k = `rl:${key}`;
    const [[, count]] = (await this.redis
      .multi()
      .incr(k)
      .expire(k, windowSeconds, 'NX')
      .exec()) as [[unknown, number]];
    return count <= limit;
  }
}
