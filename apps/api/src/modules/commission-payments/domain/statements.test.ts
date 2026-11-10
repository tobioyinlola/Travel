import { describe, expect, it } from 'vitest';
import { matchLine, parseStatementCsv } from './statements.js';

describe('supplier statements (FR-COM-04)', () => {
  it('parses csv with or without a header, in exact minor units', () => {
    expect(parseStatementCsv('confirmation_code,amount\nab12cd3,54.12\nXY99,7\nQ1,0.5')).toEqual([
      { confirmationCode: 'AB12CD3', amountMinor: 5412n },
      { confirmationCode: 'XY99', amountMinor: 700n },
      { confirmationCode: 'Q1', amountMinor: 50n },
    ]);
  });
  it('rejects malformed lines and too many decimals', () => {
    expect(() => parseStatementCsv('AB12,abc')).toThrow(/Line 1/);
    expect(() => parseStatementCsv('AB12,1.234')).toThrow(/decimals/);
  });
  it('matches exactly, flags variance either way, and reports unknown codes', () => {
    expect(matchLine(5412n, 5412n)).toEqual({ kind: 'matched' });
    expect(matchLine(5000n, 5412n)).toEqual({ kind: 'mismatch', varianceMinor: -412n });
    expect(matchLine(6000n, 5412n)).toEqual({ kind: 'mismatch', varianceMinor: 588n });
    expect(matchLine(100n, null)).toEqual({ kind: 'unmatched' });
  });
});
