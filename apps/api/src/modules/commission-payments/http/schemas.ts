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

export const statementImportSchema = z
  .object({
    supplier: z.string().trim().min(2).max(100),
    reference: z.string().trim().min(1).max(100),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
    csv: z.string().max(500_000).optional(),
    lines: z
      .array(
        z.object({
          confirmationCode: z.string().min(1).max(40),
          amount: z.string().regex(/^\d+(\.\d+)?$/),
        }),
      )
      .max(5000)
      .optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.lines), { message: 'Send either csv or lines' });

export const importResultSchema = z.object({
  statementId: z.uuid(),
  lines: z.number().int(),
  matched: z.number().int(),
  mismatch: z.number().int(),
  unmatched: z.number().int(),
  total: money,
});

const lineSchema = z.object({
  id: z.uuid(),
  statementId: z.uuid(),
  supplier: z.string(),
  confirmationCode: z.string(),
  amount: money,
  status: z.enum(['matched', 'mismatch', 'unmatched', 'resolved', 'rejected']),
  commissionId: z.uuid().nullable(),
  expected: money.nullable(),
  variance: money.nullable(),
  note: z.string().nullable(),
});
export const statementLinesSchema = z.object({ items: z.array(lineSchema) });
export const statementListSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      supplier: z.string(),
      reference: z.string(),
      total: money,
      importedAt: z.iso.datetime(),
      matched: z.number().int(),
      mismatches: z.number().int(),
      unmatched: z.number().int(),
    }),
  ),
});
export const resolveSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  note: z.string().trim().min(2).max(500),
});
export const lineResultSchema = lineSchema;
export const reconciliationSchema = z.object({
  ledgerBalanced: z.boolean(),
  receivableVarianceMinor: z.string(),
  openMismatches: z.number().int(),
  unmatchedLines: z.number().int(),
  overdueCommissions: z.number().int(),
  ok: z.boolean(),
});

const payoutStatus = z.enum(['pending', 'paid', 'failed', 'skipped']);
export const payoutSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  advisorId: z.uuid(),
  status: payoutStatus,
  gross: money,
  debtApplied: money,
  net: money,
  skipReason: z.string().nullable(),
  failureReason: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
});

export const payoutRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(['draft', 'approved', 'completed', 'cancelled']),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  approvedBy: z.array(z.uuid()),
  approvalsNeeded: z.number().int(),
  approvedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  totalNet: money,
  totalPaid: money,
  payouts: z.array(payoutSchema),
});
export const payoutRunListSchema = z.object({ items: z.array(payoutRunSchema) });

export const payoutAccountSchema = z.object({
  accountRef: z.string().regex(/^acct_[a-z0-9_]{3,60}$/),
  country: z.string().regex(/^[A-Z]{2}$/),
});

export const advisorPayoutsSchema = z.object({
  account: payoutAccountSchema.nullable(),
  payable: money,
  openDebt: money,
  minimumPayout: money,
  eligible: z.boolean(),
  blockers: z.array(z.string()),
  payouts: z.array(
    payoutSchema.extend({
      lines: z.array(
        z.object({ commissionId: z.uuid(), propertyName: z.string(), advisorShare: money }),
      ),
    }),
  ),
});

export const holdSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const holdReleaseSchema = z.object({ note: z.string().trim().min(2).max(500) });
export const holdResultSchema = z.object({ advisorId: z.uuid(), onHold: z.boolean() });
export const adjustmentSchema = z.object({
  advisorId: z.uuid(),
  amountMinor: z.string().regex(/^-?\d{1,12}$/),
  reasonCode: z.enum(['goodwill', 'correction', 'fee', 'other']),
  note: z.string().trim().min(3).max(500),
});
export const adjustmentResultSchema = z.object({
  id: z.uuid(),
  advisorId: z.uuid(),
  amount: money,
});
