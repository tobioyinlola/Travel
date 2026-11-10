import type { EventEnvelope } from '@atp/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestContext } from '../src/platform/context/request-context.js';
import { makePlatform, type TestPlatform } from './helpers.js';

const ids = {
  bookingId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e5f',
  tripId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e60',
  advisorId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e61',
  supplierId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e62',
};

/** Sprint 0 exit criterion: one module publishes through the outbox and another consumes it once. */
describe('transactional outbox and event delivery', () => {
  let p: TestPlatform;
  const received: Array<{ handler: string; event: EventEnvelope; role: string }> = [];

  beforeAll(() => {
    p = makePlatform();
    p.bus.subscribe({
      module: 'notifications',
      handler: 'test.notifications.onBookingConfirmed',
      event: 'BookingConfirmed',
      version: 1,
      async handle(event, tx) {
        const [r] = await tx.query<{ r: string }>('SELECT current_user AS r');
        received.push({ handler: 'notifications', event, role: r!.r });
      },
    });
    p.bus.subscribe({
      module: 'reporting',
      handler: 'test.reporting.onBookingConfirmed',
      event: 'BookingConfirmed',
      version: 1,
      async handle(event, tx) {
        const [r] = await tx.query<{ r: string }>('SELECT current_user AS r');
        received.push({ handler: 'reporting', event, role: r!.r });
      },
    });
  });

  beforeEach(async () => {
    received.length = 0;
    await p.reset();
  });

  afterAll(() => p.close());

  it('does not publish an event when the transaction rolls back', async () => {
    await expect(
      p.db.transaction('booking', async (tx) => {
        await tx.publish({ type: 'BookingConfirmed', version: 1, payload: ids });
        throw new Error('supplier said no');
      }),
    ).rejects.toThrow('supplier said no');
    const r = await p.admin.query('SELECT count(*)::int AS n FROM platform.outbox');
    expect(r.rows[0].n).toBe(0);
  });

  it('delivers a committed event to every subscriber, under the subscriber role, with correlation id', async () => {
    await requestContext.run({ correlationId: 'corr-123' }, () =>
      p.db.transaction('booking', (tx) =>
        tx.publish({ type: 'BookingConfirmed', version: 1, payload: ids }),
      ),
    );
    expect(await p.relay.drain()).toBe(1);
    await p.runJobs();

    expect(received.map((r) => r.handler).sort()).toEqual(['notifications', 'reporting']);
    expect(received.find((r) => r.handler === 'notifications')?.role).toBe('atp_mod_notifications');
    const event = received[0]!.event;
    expect(event).toMatchObject({
      type: 'BookingConfirmed',
      version: 1,
      producer: 'booking',
      correlationId: 'corr-123',
    });
    expect(event.payload).toEqual(ids);
  });

  it('processes each event once per handler even if delivered twice', async () => {
    const eventId = await p.db.transaction('booking', (tx) =>
      tx.publish({ type: 'BookingConfirmed', version: 1, payload: ids }),
    );
    await p.relay.drain();
    await p.runJobs();
    expect(received).toHaveLength(2);

    // Simulate a redelivery (e.g. relay crash after enqueue): put the same event back in the outbox.
    await p.admin.query('UPDATE platform.outbox SET relayed_at = NULL WHERE id = $1', [eventId]);
    await p.relay.drain();
    await p.runJobs();
    expect(received).toHaveLength(2);
  });

  it('rejects payloads that break the event contract', async () => {
    await expect(
      p.db.transaction('booking', (tx) =>
        tx.publish({ type: 'BookingConfirmed', version: 1, payload: { bookingId: 'not-a-uuid' } }),
      ),
    ).rejects.toThrow();
  });

  it('rejects event names that are not past-tense facts', async () => {
    await expect(
      p.db.transaction('booking', (tx) =>
        tx.publish({ type: 'ConfirmBooking', version: 1, payload: {} }),
      ),
    ).rejects.toThrow(/past-tense/);
  });

  it('marks events with no subscribers as relayed', async () => {
    await p.db.transaction('identity', (tx) =>
      tx.publish({
        type: 'AdvisorApproved',
        version: 1,
        payload: { advisorId: ids.advisorId, userId: ids.tripId },
      }),
    );
    expect(await p.relay.drain()).toBe(1);
    const r = await p.admin.query(
      'SELECT count(*)::int AS n FROM platform.outbox WHERE relayed_at IS NULL',
    );
    expect(r.rows[0].n).toBe(0);
  });
});
