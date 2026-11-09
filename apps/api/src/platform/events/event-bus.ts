import type { EventEnvelope } from '@atp/contracts';
import type { QueueClass, Tx } from '../db/tx.js';

export interface EventSubscription<P = Record<string, unknown>> {
  /** Module whose role the handler's transaction runs under. */
  module: string;
  /** Stable, unique handler name, e.g. `notifications.sendAdvisorWelcome`. Renaming it re-delivers events. */
  handler: string;
  event: string;
  version: number;
  queue?: QueueClass;
  maxAttempts?: number;
  /** Runs inside a transaction that also records the event as processed, so a retry never repeats work. */
  handle(event: EventEnvelope<string, P>, tx: Tx): Promise<void>;
}

/**
 * In-process subscription registry. Delivery happens after commit: the outbox relay turns each
 * (event, subscriber) pair into a job, which gives every handler its own retries and dead-lettering.
 */
export class EventBus {
  private readonly subs: EventSubscription[] = [];

  subscribe<P = Record<string, unknown>>(sub: EventSubscription<P>): void {
    if (this.subs.some((s) => s.handler === sub.handler)) {
      throw new Error(`Duplicate event handler name: ${sub.handler}`);
    }
    this.subs.push(sub as unknown as EventSubscription);
  }

  subscribersOf(type: string, version: number): EventSubscription[] {
    return this.subs.filter((s) => s.event === type && s.version === version);
  }

  all(): readonly EventSubscription[] {
    return this.subs;
  }

  static jobName(handler: string): string {
    return `event:${handler}`;
  }
}
