import type request from 'supertest';
import { inDays, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
export interface Rate {
  rateKey: string;
  refundable: boolean;
  paymentModes: string[];
}
export interface BookedLine {
  supplier: string;
  confirmationCode: string;
}
export interface Booked {
  id: string;
  lines: BookedLine[];
}

export const major = (minor: string | bigint) => {
  const v = BigInt(minor);
  return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
};

/** A booking confirmed through the real flow (pay at hotel), starting `startIn` days from now. */
export async function confirmedBooking(
  t: TestApp,
  agent: Agent,
  clientId: string,
  startIn = 60,
  destination = 'lisbon',
): Promise<Booked & { tripId: string }> {
  const from = inDays(startIn);
  const to = inDays(startIn + 3);
  const trip = (
    await agent
      .post('/v1/trips')
      .send({ clientId, title: 'Stay', startDate: from, endDate: to, adults: 2 })
      .expect(201)
  ).body;
  const rates: Rate[] = (
    await agent
      .get('/v1/catalog/search')
      .query({ destination, checkIn: from, checkOut: to, adults: 2 })
      .expect(200)
  ).body.results.flatMap((r: { rates: Rate[] }) => r.rates);
  const rate = rates.find((r) => r.refundable && r.paymentModes.includes('pay_at_hotel'))!;
  await agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
  const url = (
    await agent.post(`/v1/trips/${trip.id}/proposals`).send({ sendEmail: false }).expect(201)
  ).body.proposal.url as string;
  const token = url.split('/p/')[1]!;
  await t
    .http()
    .post(`/v1/proposal-links/${token}/decision`)
    .send({ decision: 'approve', name: 'Grace Hopper' })
    .expect(200);
  await t.settle();
  await t
    .http()
    .post(`/v1/checkout/${token}/confirm`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
      paymentMode: 'pay_at_hotel',
    })
    .expect(200);
  await t.settle();
  const b = (await agent.get('/v1/bookings').query({ tripId: trip.id }).expect(200)).body.items[0];
  return { ...b, tripId: trip.id };
}

/** The supplier pays this booking's commission exactly as expected (finance imports a statement). */
export async function supplierPays(fin: Agent, agent: Agent, booking: Booked) {
  const c = (await agent.get('/v1/commissions').expect(200)).body.items.find(
    (i: { bookingId: string }) => i.bookingId === booking.id,
  );
  await fin
    .post('/v1/finance/statements')
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      supplier: booking.lines[0]!.supplier,
      reference: `ST-${Math.random().toString(36).slice(2, 8)}`,
      lines: [
        {
          confirmationCode: booking.lines[0]!.confirmationCode,
          amount: major(c.expected.amountMinor),
        },
      ],
    })
    .expect(201);
  return c;
}
