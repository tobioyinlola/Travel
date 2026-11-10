/** Divide with half-even rounding on bigints (banker's rounding, no floating point). */
function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) return q + 1n;
  return q;
}

export interface CommissionSplit {
  expectedMinor: bigint;
  advisorMinor: bigint;
  platformMinor: bigint;
}

/**
 * FR-COM-01: expected commission = commissionable amount x supplier rate.
 * FR-COM-02: split by the advisor's tier, each figure rounded to a minor unit. The platform share is the
 * remainder, so the parts always add up to the whole.
 * AC-05: $2,500 x 12% = $300 -> $210 advisor / $90 platform at the 70% base split.
 */
export function splitCommission(input: {
  commissionableMinor: bigint;
  rateBps: number;
  advisorShareBps: number;
}): CommissionSplit {
  const expectedMinor = divHalfEven(input.commissionableMinor * BigInt(input.rateBps), 10_000n);
  const advisorMinor = divHalfEven(expectedMinor * BigInt(input.advisorShareBps), 10_000n);
  return { expectedMinor, advisorMinor, platformMinor: expectedMinor - advisorMinor };
}
