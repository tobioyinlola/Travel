import { describe, expect, it } from 'vitest';
import { Money, MoneyError, Rate, minorUnitDigits } from './money.js';

describe('Money', () => {
  it('knows minor-unit digits per currency', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('BHD')).toBe(3);
    expect(minorUnitDigits('NGN')).toBe(2);
    expect(() => minorUnitDigits('usd')).toThrow(MoneyError);
  });

  it('parses and prints decimal strings exactly', () => {
    expect(Money.of('2500.00', 'USD').amountMinor).toBe(250000n);
    expect(Money.of('0.1', 'USD').amountMinor).toBe(10n);
    expect(Money.of('-12.34', 'USD').toDecimalString()).toBe('-12.34');
    expect(Money.of('500', 'JPY').toDecimalString()).toBe('500');
    expect(() => Money.of('1.001', 'USD')).toThrow(MoneyError);
  });

  it('refuses to mix currencies', () => {
    expect(() => Money.of('1', 'USD').add(Money.of('1', 'EUR'))).toThrow(MoneyError);
  });

  it('AC-05: $2,500 at 12% is $300, split 70/30 is $210 / $90', () => {
    const commissionable = Money.of('2500.00', 'USD');
    const expected = commissionable.multiply(Rate.of('12%'));
    expect(expected.toDecimalString()).toBe('300.00');
    const advisor = expected.multiply(Rate.of('0.70'));
    const platform = expected.subtract(advisor);
    expect(advisor.toDecimalString()).toBe('210.00');
    expect(platform.toDecimalString()).toBe('90.00');
  });

  it('rounds to the minor unit with half-even by default', () => {
    expect(Money.ofMinor(5n, 'USD').multiply(Rate.of('0.5')).amountMinor).toBe(2n); // 2.5 -> 2
    expect(Money.ofMinor(7n, 'USD').multiply(Rate.of('0.5')).amountMinor).toBe(4n); // 3.5 -> 4
    expect(Money.ofMinor(5n, 'USD').multiply(Rate.of('0.5'), 'half-up').amountMinor).toBe(3n);
    expect(Money.ofMinor(-5n, 'USD').multiply(Rate.of('0.5'), 'half-up').amountMinor).toBe(-3n);
  });

  it('allocates without losing or creating a minor unit', () => {
    const parts = Money.ofMinor(100n, 'USD').allocate([1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    const split = Money.ofMinor(1001n, 'USD').allocate([70, 30]);
    expect(split[0]!.amountMinor + split[1]!.amountMinor).toBe(1001n);
    const neg = Money.ofMinor(-100n, 'USD').allocate([1, 1, 1]);
    expect(neg.reduce((a, b) => a + b.amountMinor, 0n)).toBe(-100n);
  });

  it('serialises minor units as strings', () => {
    const m = Money.ofMinor(9007199254740993n, 'USD');
    expect(JSON.parse(JSON.stringify(m))).toEqual({
      amountMinor: '9007199254740993',
      currency: 'USD',
    });
    expect(Money.fromJSON(m.toJSON()).equals(m)).toBe(true);
  });

  it('rejects unsafe numbers', () => {
    expect(() => Money.ofMinor(0.1, 'USD')).toThrow(MoneyError);
  });

  it('supports basis points', () => {
    expect(Money.of('100', 'USD').multiply(Rate.bps(1250)).toDecimalString()).toBe('12.50');
  });
});
