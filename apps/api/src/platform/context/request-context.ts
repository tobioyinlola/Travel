import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Per-request / per-job context carried through modules, events and jobs (ARCH observability). */
export interface RequestContext {
  correlationId: string;
  actorId?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  correlationId(): string | null {
    return storage.getStore()?.correlationId ?? null;
  },
  newCorrelationId(): string {
    return randomUUID();
  },
};
