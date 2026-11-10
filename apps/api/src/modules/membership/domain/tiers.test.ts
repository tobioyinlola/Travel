import { describe, expect, it } from 'vitest';
import { nextTier, tierFor, type TierDef } from './tiers.js';

const tiers: TierDef[] = [
  { code: 'starter', position: 1, minSalesMinor: 0n, advisorShareBps: 7000 },
  { code: 'pro', position: 2, minSalesMinor: 30_000_000n, advisorShareBps: 7500 },
  { code: 'elite', position: 3, minSalesMinor: 75_000_000n, advisorShareBps: 8000 },
];

describe('split tiers (FR-MEM-05)', () => {
  it('starts at the base tier', () => expect(tierFor(0n, tiers).code).toBe('starter'));
  it('upgrades exactly at the $300K threshold', () => {
    expect(tierFor(29_999_999n, tiers).code).toBe('starter');
    expect(tierFor(30_000_000n, tiers).code).toBe('pro');
  });
  it('reaches the top tier and has no next', () => {
    const top = tierFor(90_000_000n, tiers);
    expect(top.code).toBe('elite');
    expect(nextTier(top, tiers)).toBeNull();
    expect(nextTier(tierFor(0n, tiers), tiers)?.code).toBe('pro');
  });
  it('does not depend on the order tiers are supplied in', () => {
    expect(tierFor(40_000_000n, [...tiers].reverse()).code).toBe('pro');
  });
});
