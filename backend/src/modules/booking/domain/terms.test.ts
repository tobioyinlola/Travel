import { describe, expect, it } from 'vitest';
import {
  cancellationPenalty,
  dueNow,
  paymentOptions,
  refundAfterPenalty,
  type LineTerms,
} from './terms.js';

const line = (totalMinor: number, modes: LineTerms['paymentModes']): LineTerms => ({
  totalMinor: BigInt(totalMinor),
  paymentModes: modes,
});

describe('payment options (FR-BKG-03)', () => {
  it('offers only modes every hotel accepts', () => {
    const opts = paymentOptions([
      line(100_00, ['pay_at_hotel', 'prepay', 'deposit']),
      line(200_00, ['prepay', 'deposit']),
    ]);
    expect(opts.map((o) => o.mode)).toEqual(['prepay', 'deposit']);
  });

  it('prepay collects everything, pay at hotel nothing, deposit 20% per hotel rounded up', () => {
    const lines = [
      line(100_01, ['pay_at_hotel', 'prepay', 'deposit']),
      line(50_00, ['pay_at_hotel', 'prepay', 'deposit']),
    ];
    expect(dueNow('pay_at_hotel', lines)).toBe(0n);
    expect(dueNow('prepay', lines)).toBe(150_01n);
    expect(dueNow('deposit', lines)).toBe(2001n + 1000n); // ceil(10001 * 0.2) + 5000 * 0.2
  });

  it('never asks for a deposit above the total', () => {
    expect(dueNow('deposit', [line(1, ['deposit'])])).toBe(1n);
  });

  it('offers nothing when no mode is shared', () => {
    expect(paymentOptions([line(10, ['pay_at_hotel']), line(10, ['prepay'])])).toEqual([]);
    expect(paymentOptions([])).toEqual([]);
  });
});

describe('cancellation penalty (FR-BKG-05)', () => {
  const free = new Date('2030-06-01T12:00:00Z');
  const base = { totalMinor: 900_00n, nights: 3, refundable: true, freeCancellationUntil: free };

  it('is free inside the window', () => {
    expect(cancellationPenalty(base, new Date('2030-05-30T00:00:00Z'))).toBe(0n);
  });
  it('is the first night after the window', () => {
    expect(cancellationPenalty(base, new Date('2030-06-02T00:00:00Z'))).toBe(300_00n);
  });
  it('is everything when non-refundable', () => {
    expect(
      cancellationPenalty(
        { ...base, refundable: false, freeCancellationUntil: null },
        new Date('2030-01-01'),
      ),
    ).toBe(900_00n);
  });
  it('refund is what was paid minus penalties, never negative', () => {
    expect(refundAfterPenalty(500_00n, 120_00n)).toBe(380_00n);
    expect(refundAfterPenalty(100_00n, 300_00n)).toBe(0n);
  });
});
