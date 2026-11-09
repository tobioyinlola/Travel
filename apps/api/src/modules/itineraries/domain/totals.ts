import { Money } from '../../shared-kernel/index.js';

export interface MoneyJson {
  amountMinor: string;
  currency: string;
}

export interface PricedItem {
  id: string;
  label: string;
  kind: 'hotel' | 'activity' | 'transfer' | 'note';
  /** Charged at booking (hotel total includes taxes). Null for unpriced items such as notes. */
  amount: MoneyJson | null;
  taxes?: MoneyJson | undefined;
  /** Paid by the traveler at the property, outside our total. */
  payableAtProperty?: MoneyJson | undefined;
}

export interface ProposalTotals {
  currency: string;
  lines: Array<{ itemId: string; label: string; amount: MoneyJson }>;
  /** Taxes included in the line amounts, shown for transparency. */
  taxesIncluded: MoneyJson;
  planningFee: MoneyJson;
  total: MoneyJson;
  payableAtProperty: MoneyJson;
}

/**
 * FR-ITN-03: proposal total = priced items (taxes included) + advisor planning fee. Fees the hotel collects
 * on site are listed separately and never folded into the total. Everything must be in the trip currency.
 */
export function proposalTotals(
  currency: string,
  items: PricedItem[],
  planningFeeMinor: bigint,
): ProposalTotals {
  const money = (m: MoneyJson) => {
    if (m.currency !== currency) throw new Error(`Item in ${m.currency} on a ${currency} trip`);
    return Money.ofMinor(m.amountMinor, m.currency);
  };
  let subtotal = Money.zero(currency);
  let taxes = Money.zero(currency);
  let atProperty = Money.zero(currency);
  const lines: ProposalTotals['lines'] = [];
  for (const it of items) {
    if (it.amount) {
      subtotal = subtotal.add(money(it.amount));
      lines.push({ itemId: it.id, label: it.label, amount: it.amount });
    }
    if (it.taxes) taxes = taxes.add(money(it.taxes));
    if (it.payableAtProperty) atProperty = atProperty.add(money(it.payableAtProperty));
  }
  const fee = Money.ofMinor(planningFeeMinor, currency);
  return {
    currency,
    lines,
    taxesIncluded: taxes.toJSON(),
    planningFee: fee.toJSON(),
    total: subtotal.add(fee).toJSON(),
    payableAtProperty: atProperty.toJSON(),
  };
}
