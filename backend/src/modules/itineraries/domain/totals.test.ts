import { describe, expect, it } from 'vitest';
import { proposalTotals } from './totals.js';

const usd = (n: number) => ({ amountMinor: String(n), currency: 'USD' });

describe('proposal totals (FR-ITN-03)', () => {
  it('adds priced items and the planning fee; lists taxes and on-site fees separately', () => {
    const t = proposalTotals(
      'USD',
      [
        {
          id: 'h1',
          label: 'Hotel',
          kind: 'hotel',
          amount: usd(112000),
          taxes: usd(12000),
          payableAtProperty: usd(2400),
        },
        { id: 'a1', label: 'Food tour', kind: 'activity', amount: usd(9000) },
        { id: 'n1', label: 'Pack light', kind: 'note', amount: null },
      ],
      15000n,
    );
    expect(t.total).toEqual(usd(136000));
    expect(t.taxesIncluded).toEqual(usd(12000));
    expect(t.payableAtProperty).toEqual(usd(2400));
    expect(t.planningFee).toEqual(usd(15000));
    expect(t.lines.map((l) => l.itemId)).toEqual(['h1', 'a1']);
  });

  it('refuses mixed currencies', () => {
    expect(() =>
      proposalTotals(
        'USD',
        [{ id: 'x', label: 'x', kind: 'activity', amount: { amountMinor: '1', currency: 'EUR' } }],
        0n,
      ),
    ).toThrow();
  });
});
