import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { EventBus } from '../../../platform/events/event-bus.js';
import { REDIS } from '../../../platform/tokens.js';

export interface LiveMessage {
  data: { type: 'booking.updated'; bookingId: string; tripId: string; status: string };
  type: string;
}

const channel = (advisorId: string) => `live:advisor:${advisorId}`;

/**
 * Live status for the advisor (FRD: SSE channel for advisor live status). `BookingUpdated` events arrive after
 * commit; each is relayed over Redis pub/sub so any API instance holding the advisor's stream can forward it.
 * The message only says "refresh": clients fetch the booking through the normal, access-checked API.
 */
@Injectable()
export class LiveStatusService implements OnModuleInit {
  private readonly logger = new Logger('LiveStatus');

  constructor(
    private readonly bus: EventBus,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<{ bookingId: string; tripId: string; advisorId: string; status: string }>({
      module: 'booking',
      handler: 'booking.pushLiveStatus',
      event: 'BookingUpdated',
      version: 1,
      handle: async (e) => {
        if (this.redis.status === 'wait') await this.redis.connect();
        const { advisorId, ...data } = e.payload;
        await this.redis.publish(
          channel(advisorId),
          JSON.stringify({ type: 'booking.updated', ...data }),
        );
      },
    });
  }

  /** One Server-Sent Events stream per connected advisor tab; a heartbeat keeps proxies from closing it. */
  stream(advisorId: string): Observable<LiveMessage> {
    return new Observable<LiveMessage>((subscriber) => {
      const sub = this.redis.duplicate();
      let closed = false;
      const heartbeat = setInterval(
        () =>
          subscriber.next({
            type: 'ping',
            data: { type: 'booking.updated', bookingId: '', tripId: '', status: 'ping' },
          }),
        25_000,
      );
      void (async () => {
        try {
          if (sub.status === 'wait') await sub.connect();
          await sub.subscribe(channel(advisorId));
          sub.on('message', (_c, raw) => {
            try {
              subscriber.next({ type: 'booking', data: JSON.parse(raw) });
            } catch {
              /* ignore malformed */
            }
          });
          subscriber.next({
            type: 'ready',
            data: { type: 'booking.updated', bookingId: '', tripId: '', status: 'ready' },
          });
        } catch (e) {
          this.logger.warn(`Live stream failed: ${(e as Error).message}`);
          if (!closed) subscriber.error(e);
        }
      })();
      return () => {
        closed = true;
        clearInterval(heartbeat);
        sub.disconnect();
      };
    });
  }
}
