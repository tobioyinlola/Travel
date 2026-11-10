export interface StatementLineInput {
  confirmationCode: string;
  amountMinor: bigint;
}

/** Parse a supplier statement pasted as CSV: `confirmation_code,amount` (amount in major units, e.g. 54.12). */
export function parseStatementCsv(csv: string, minorDigits = 2): StatementLineInput[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: StatementLineInput[] = [];
  for (const [i, line] of lines.entries()) {
    const [code, amount] = line.split(',').map((x) => x.trim());
    if (i === 0 && /confirmation|code|reference/i.test(code ?? '')) continue; // header
    if (!code || !amount || !/^\d+(\.\d+)?$/.test(amount))
      throw new Error(`Line ${i + 1} is not "confirmation_code,amount"`);
    const [whole, frac = ''] = amount.split('.');
    if (frac.length > minorDigits) throw new Error(`Line ${i + 1}: too many decimals`);
    out.push({
      confirmationCode: code.toUpperCase(),
      amountMinor: BigInt(whole! + frac.padEnd(minorDigits, '0')),
    });
  }
  return out;
}

export type MatchOutcome =
  { kind: 'matched' } | { kind: 'mismatch'; varianceMinor: bigint } | { kind: 'unmatched' };

/** FR-COM-04: exact amount settles the commission; any difference is a variance for a person to decide. */
export function matchLine(paidMinor: bigint, expectedMinor: bigint | null): MatchOutcome {
  if (expectedMinor === null) return { kind: 'unmatched' };
  return paidMinor === expectedMinor
    ? { kind: 'matched' }
    : { kind: 'mismatch', varianceMinor: paidMinor - expectedMinor };
}
