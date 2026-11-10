import type { PaymentMode } from '../../catalog/index.js';

/** Share of each hotel's total collected up front in `deposit` mode; the rest is paid at the property. */
export const DEPOSIT_PERCENT = 20n;

const ORDER: PaymentMode[] = ['pay_at_hotel', 'prepay', 'deposit'];

export interface LineTerms {
  totalMinor: bigint;
  paymentModes: readonly PaymentMode[];
}

export interface PaymentOption {
  mode: PaymentMode;
  /** Collected by the platform now. Zero for pay at hotel. */
  dueNowMinor: bigint;
}

export function dueNow(mode: PaymentMode, lines: readonly LineTerms[]): bigint {
  switch (mode) {
    case 'pay_at_hotel':
      return 0n;
    case 'prepay':
      return lines.reduce((n, l) => n + l.totalMinor, 0n);
    case 'deposit':
      // Round up per hotel so a small stay never rounds to a zero deposit; never more than the total.
      return lines.reduce((n, l) => {
        const d = (l.totalMinor * DEPOSIT_PERCENT + 99n) / 100n;
        return n + (d > l.totalMinor ? l.totalMinor : d);
      }, 0n);
  }
}

/** FR-BKG-03: only modes every hotel in the booking accepts can be offered. */
export function paymentOptions(lines: readonly LineTerms[]): PaymentOption[] {
  if (lines.length === 0) return [];
  return ORDER.filter((m) => lines.every((l) => l.paymentModes.includes(m))).map((mode) => ({
    mode,
    dueNowMinor: dueNow(mode, lines),
  }));
}

export interface CancellationTerms {
  totalMinor: bigint;
  nights: number;
  refundable: boolean;
  freeCancellationUntil: Date | null;
}

/**
 * What cancelling now is expected to cost (FR-BKG-05: "penalty shown"). The supplier has the last word and
 * reports the actual penalty when it cancels; this follows the terms stated on the rate:
 * free inside the window, the first night after it, everything when the rate is non-refundable.
 */
export function cancellationPenalty(t: CancellationTerms, now: Date): bigint {
  if (!t.refundable) return t.totalMinor;
  if (t.freeCancellationUntil && now <= t.freeCancellationUntil) return 0n;
  const firstNight = (t.totalMinor + BigInt(t.nights) / 2n) / BigInt(Math.max(1, t.nights));
  return firstNight > t.totalMinor ? t.totalMinor : firstNight;
}

/** The traveler gets back what they paid minus what the suppliers keep, never less than zero. */
export function refundAfterPenalty(paidMinor: bigint, penaltyMinor: bigint): bigint {
  const r = paidMinor - penaltyMinor;
  return r > 0n ? r : 0n;
}
