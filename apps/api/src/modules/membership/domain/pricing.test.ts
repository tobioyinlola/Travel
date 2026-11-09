import { describe, expect, it } from 'vitest';
import { Money } from '../../shared-kernel/index.js';
import { periodEnd, promoProblem, quote, type PromoCode } from './pricing.js';

const base: PromoCode = {
  code: 'X',
  kind: 'waiver',
  percentBps: null,
  amountMinor: null,
  currency: null,
  expiresAt: null,
  maxRedemptions: null,
  redemptions: 0,
  active: true,
};
const price = Money.of('299.00', 'USD');

describe('membership pricing (FR-MEM-04)', () => {
  it('charges full price without a promo', () => {
    expect(quote(price, null).total.toDecimalString()).toBe('299.00');
  });
  it('waives the fee entirely', () => {
    expect(quote(price, base).total.isZero()).toBe(true);
  });
  it('applies a percentage discount with rounding to the cent', () => {
    const q = quote(price, { ...base, kind: 'percent_off', percentBps: 3333 });
    expect(q.discount.toDecimalString()).toBe('99.66');
    expect(q.total.toDecimalString()).toBe('199.34');
  });
  it('never discounts below zero', () => {
    const q = quote(price, { ...base, kind: 'amount_off', amountMinor: 50000n, currency: 'USD' });
    expect(q.total.isZero()).toBe(true);
  });
  it('rejects expired, exhausted, inactive and wrong-currency codes', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(promoProblem({ ...base, expiresAt: new Date('2026-11-01T00:00:00Z') }, now, 'USD')).toBe(
      'expired',
    );
    expect(promoProblem({ ...base, maxRedemptions: 100, redemptions: 100 }, now, 'USD')).toBe(
      'exhausted',
    );
    expect(promoProblem({ ...base, active: false }, now, 'USD')).toBe('inactive');
    expect(
      promoProblem({ ...base, kind: 'amount_off', amountMinor: 1n, currency: 'EUR' }, now, 'USD'),
    ).toBe('currency_mismatch');
    expect(promoProblem(base, now, 'USD')).toBeNull();
  });
  it('computes billing period ends in UTC', () => {
    expect(periodEnd(new Date('2026-11-30T12:00:00Z'), 'quarter').toISOString()).toBe(
      '2027-03-02T12:00:00.000Z',
    );
    expect(periodEnd(new Date('2026-11-09T00:00:00Z'), 'year').toISOString()).toBe(
      '2027-11-09T00:00:00.000Z',
    );
  });
});
