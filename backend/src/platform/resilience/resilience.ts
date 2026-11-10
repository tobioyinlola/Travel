/**
 * Adapter resilience (ARCH "Resilience patterns for every adapter"): explicit timeouts and a circuit breaker
 * per provider, so one slow supplier degrades its own results instead of the whole request.
 */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';
}

export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold?: number;
  /** How long the circuit stays open before one trial call is allowed. */
  openMs?: number;
  now?: () => number;
}

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = 'closed';
  private readonly threshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    opts: BreakerOptions = {},
  ) {
    this.threshold = opts.failureThreshold ?? 5;
    this.openMs = opts.openMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  get current(): BreakerState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs)
      this.state = 'half_open';
    return this.state;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.current;
    if (state === 'open') throw new CircuitOpenError(`${this.name} circuit is open`);
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (e) {
      this.failures += 1;
      if (state === 'half_open' || this.failures >= this.threshold) {
        this.state = 'open';
        this.openedAt = this.now();
      }
      throw e;
    }
  }
}
