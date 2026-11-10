/**
 * Money is stored as an integer count of minor units (cents, kobo, ...) plus an ISO 4217 code.
 * Floating point is never used for money (ARCH "Money and the ledger", NFR-11).
 */
export type RoundingMode = 'half-up' | 'half-even' | 'down';

const CURRENCY_RE = /^[A-Z]{3}$/;
const minorUnitCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (USD 2, JPY 0, BHD 3), taken from the ICU data in Node. */
export function minorUnitDigits(currency: string): number {
  const cached = minorUnitCache.get(currency);
  if (cached !== undefined) return cached;
  if (!CURRENCY_RE.test(currency))
    throw new MoneyError(`Invalid ISO 4217 currency code: ${currency}`);
  let digits: number;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    throw new MoneyError(`Unknown currency: ${currency}`);
  }
  minorUnitCache.set(currency, digits);
  return digits;
}

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** Divide with rounding on bigints. denominator must be > 0. */
function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) throw new MoneyError('Denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let q = abs / denominator;
  const r = abs % denominator;
  if (r !== 0n && mode !== 'down') {
    const twice = r * 2n;
    if (twice > denominator) q += 1n;
    else if (twice === denominator) {
      if (mode === 'half-up' || (mode === 'half-even' && q % 2n === 1n)) q += 1n;
    }
  }
  return negative ? -q : q;
}

/** A decimal rate such as "0.12" or "12.5%" parsed to an exact fraction. */
export class Rate {
  private constructor(
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  static of(value: string): Rate {
    const trimmed = value.trim();
    const isPercent = trimmed.endsWith('%');
    const raw = isPercent ? trimmed.slice(0, -1) : trimmed;
    if (!/^\d+(\.\d+)?$/.test(raw)) throw new MoneyError(`Invalid rate: ${value}`);
    const [int, frac = ''] = raw.split('.');
    const numerator = BigInt(int + frac);
    let denominator = 10n ** BigInt(frac.length);
    if (isPercent) denominator *= 100n;
    if (numerator === 0n) denominator = 1n;
    return new Rate(numerator, denominator);
  }

  /** Basis points: 1200 bps = 12%. */
  static bps(bps: number): Rate {
    if (!Number.isInteger(bps) || bps < 0) throw new MoneyError(`Invalid basis points: ${bps}`);
    return new Rate(BigInt(bps), 10_000n);
  }

  complement(): Rate {
    if (this.numerator > this.denominator)
      throw new MoneyError('Rate above 100% has no complement');
    return new Rate(this.denominator - this.numerator, this.denominator);
  }

  toString(): string {
    return `${this.numerator}/${this.denominator}`;
  }
}

export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: string,
  ) {}

  static ofMinor(amountMinor: bigint | number | string, currency: string): Money {
    minorUnitDigits(currency);
    let value: bigint;
    if (typeof amountMinor === 'bigint') value = amountMinor;
    else if (typeof amountMinor === 'number') {
      if (!Number.isSafeInteger(amountMinor))
        throw new MoneyError('Minor units must be a safe integer');
      value = BigInt(amountMinor);
    } else {
      if (!/^-?\d+$/.test(amountMinor)) throw new MoneyError(`Invalid minor units: ${amountMinor}`);
      value = BigInt(amountMinor);
    }
    return new Money(value, currency);
  }

  /** Parse a decimal major-unit string such as "2500.00". Rejects more decimals than the currency allows. */
  static of(major: string, currency: string): Money {
    const digits = minorUnitDigits(currency);
    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(major.trim());
    if (!m) throw new MoneyError(`Invalid amount: ${major}`);
    const frac = m[3] ?? '';
    if (frac.length > digits) throw new MoneyError(`${currency} allows ${digits} decimal places`);
    const minor = BigInt((m[2] ?? '0') + frac.padEnd(digits, '0'));
    return new Money(m[1] ? -minor : minor, currency);
  }

  static zero(currency: string): Money {
    return Money.ofMinor(0n, currency);
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency);
  }

  /** Multiply by an exact rate and round to the minor unit (FR-COM-02). Default rounding is half-even. */
  multiply(rate: Rate, mode: RoundingMode = 'half-even'): Money {
    return new Money(
      divRound(this.amountMinor * rate.numerator, rate.denominator, mode),
      this.currency,
    );
  }

  /**
   * Split into parts by integer ratios so the parts always sum exactly to the original.
   * Leftover minor units go to the parts with the largest remainders (ties: earlier part).
   */
  allocate(ratios: readonly number[]): Money[] {
    if (ratios.length === 0) throw new MoneyError('Need at least one ratio');
    if (ratios.some((r) => !Number.isInteger(r) || r < 0))
      throw new MoneyError('Ratios must be non-negative integers');
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total === 0) throw new MoneyError('Ratios must not all be zero');
    const sign = this.amountMinor < 0n ? -1n : 1n;
    const abs = this.amountMinor * sign;
    const bigTotal = BigInt(total);
    const parts = ratios.map((r) => (abs * BigInt(r)) / bigTotal);
    const remainders = ratios.map((r, i) => ({ i, rem: (abs * BigInt(r)) % bigTotal }));
    let leftover = abs - parts.reduce((a, b) => a + b, 0n);
    remainders.sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
    for (const { i } of remainders) {
      if (leftover === 0n) break;
      parts[i] = (parts[i] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return parts.map((p) => new Money(p * sign, this.currency));
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSame(other);
    return this.amountMinor < other.amountMinor ? -1 : this.amountMinor > other.amountMinor ? 1 : 0;
  }

  /** Decimal string in major units, e.g. "2500.00". */
  toDecimalString(): string {
    const digits = minorUnitDigits(this.currency);
    const negative = this.amountMinor < 0n;
    const abs = (negative ? -this.amountMinor : this.amountMinor)
      .toString()
      .padStart(digits + 1, '0');
    const int = digits === 0 ? abs : abs.slice(0, -digits);
    const frac = digits === 0 ? '' : `.${abs.slice(-digits)}`;
    return `${negative ? '-' : ''}${int}${frac}`;
  }

  /** Wire format: minor units as a string so JSON never loses precision. */
  toJSON(): { amountMinor: string; currency: string } {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency };
  }

  static fromJSON(json: { amountMinor: string; currency: string }): Money {
    return Money.ofMinor(json.amountMinor, json.currency);
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }
}
