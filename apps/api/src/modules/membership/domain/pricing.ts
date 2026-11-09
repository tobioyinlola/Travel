import { Money, MoneyError, Rate } from '../../shared-kernel/index.js';

export interface PromoCode {
  code: string;
  kind: 'percent_off' | 'amount_off' | 'waiver';
  percentBps: number | null;
  amountMinor: bigint | null;
  currency: string | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
}

export type PromoProblem = 'inactive' | 'expired' | 'exhausted' | 'currency_mismatch';

export function promoProblem(p: PromoCode, now: Date, currency: string): PromoProblem | null {
  if (!p.active) return 'inactive';
  if (p.expiresAt && p.expiresAt <= now) return 'expired';
  if (p.maxRedemptions !== null && p.redemptions >= p.maxRedemptions) return 'exhausted';
  if (p.kind === 'amount_off' && p.currency !== currency) return 'currency_mismatch';
  return null;
}

export interface Quote {
  subtotal: Money;
  discount: Money;
  total: Money;
}

/** FR-MEM-04: promo codes, fee waivers and pilot discounts. The discount never exceeds the price. */
export function quote(price: Money, promo: PromoCode | null): Quote {
  let discount = Money.zero(price.currency);
  if (promo) {
    if (promo.kind === 'waiver') discount = price;
    else if (promo.kind === 'percent_off')
      discount = price.multiply(Rate.bps(promo.percentBps ?? 0));
    else {
      if (promo.currency !== price.currency)
        throw new MoneyError('Promo currency does not match the plan');
      discount = Money.ofMinor(promo.amountMinor ?? 0n, price.currency);
    }
    if (discount.compare(price) > 0) discount = price;
  }
  return { subtotal: price, discount, total: price.subtract(discount) };
}

export function periodEnd(start: Date, period: 'quarter' | 'year'): Date {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (period === 'year' ? 12 : 3));
  return end;
}
