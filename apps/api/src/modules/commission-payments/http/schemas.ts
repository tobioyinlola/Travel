import { z } from 'zod';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const status = z.enum([
  'expected',
  'invoiced',
  'received',
  'reconciled',
  'payable',
  'paid',
  'reversed',
]);

export const commissionSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  propertyName: z.string(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  commissionable: money,
  rateBps: z.number().int(),
  expected: money,
  /** The tier in force when the sale was recognised (it does not change afterwards). */
  tier: z.string(),
  advisorShareBps: z.number().int(),
  advisorShare: money,
  status,
  reversalReason: z.string().nullable(),
  recognizedAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
});

export const earningsSchema = z.object({
  items: z.array(commissionSchema),
  totals: z.object({ pending: money, payable: money, paid: money, reversed: money }),
});

export const tierProgressSchema = z.object({
  tier: z.string(),
  tierName: z.string(),
  advisorShareBps: z.number().int(),
  year: z.number().int(),
  currency: z.string(),
  calendarYearSales: money,
  next: z
    .object({
      code: z.string(),
      name: z.string(),
      advisorShareBps: z.number().int(),
      remaining: money,
    })
    .nullable(),
});

export const financeCommissionSchema = commissionSchema.extend({
  advisorId: z.uuid(),
  supplier: z.string(),
  platformShare: money,
});
export const financeListSchema = z.object({ items: z.array(financeCommissionSchema) });

export const trialBalanceSchema = z.object({
  accounts: z.array(
    z.object({
      account: z.string(),
      currency: z.string(),
      debit: z.string(),
      credit: z.string(),
      balance: z.string(),
    }),
  ),
  totalDebit: z.string(),
  totalCredit: z.string(),
  balanced: z.boolean(),
});
