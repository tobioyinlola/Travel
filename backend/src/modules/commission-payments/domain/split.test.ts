import { describe, expect, it } from 'vitest';
import { splitCommission } from './split.js';

describe('commission split (FR-COM-01, 02)', () => {
  it('AC-05: $2,500 at 12% is $300, split $210 / $90 at the base tier', () => {
    expect(
      splitCommission({ commissionableMinor: 250_000n, rateBps: 1200, advisorShareBps: 7000 }),
    ).toEqual({
      expectedMinor: 30_000n,
      advisorMinor: 21_000n,
      platformMinor: 9_000n,
    });
  });

  it('rounds to a minor unit and the parts always add up', () => {
    for (const c of [1n, 99n, 12_345n, 999_999n, 250_001n]) {
      for (const share of [7000, 7500, 8000, 3333]) {
        const s = splitCommission({
          commissionableMinor: c,
          rateBps: 1050,
          advisorShareBps: share,
        });
        expect(s.advisorMinor + s.platformMinor).toBe(s.expectedMinor);
        expect(s.advisorMinor >= 0n && s.platformMinor >= 0n).toBe(true);
      }
    }
  });

  it('rounds half to even, not always up', () => {
    // 5 minor units at 10% = 0.5 -> 0 (even); 15 at 10% = 1.5 -> 2 (even)
    expect(
      splitCommission({ commissionableMinor: 5n, rateBps: 1000, advisorShareBps: 10000 })
        .expectedMinor,
    ).toBe(0n);
    expect(
      splitCommission({ commissionableMinor: 15n, rateBps: 1000, advisorShareBps: 10000 })
        .expectedMinor,
    ).toBe(2n);
  });

  it('a higher tier gives the advisor more of the same commission', () => {
    const base = splitCommission({
      commissionableMinor: 250_000n,
      rateBps: 1200,
      advisorShareBps: 7000,
    });
    const pro = splitCommission({
      commissionableMinor: 250_000n,
      rateBps: 1200,
      advisorShareBps: 7500,
    });
    expect(pro.expectedMinor).toBe(base.expectedMinor);
    expect(pro.advisorMinor).toBe(22_500n);
  });
});
