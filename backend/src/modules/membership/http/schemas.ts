import { z } from 'zod';

const money = z.object({ amountMinor: z.string(), currency: z.string() });

export const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  billingPeriod: z.enum(['quarter', 'year']),
  price: money,
});
export const quoteSchema = z.object({ subtotal: money, discount: money, total: money });
export const quoteQuerySchema = z.object({
  planCode: z.string().min(1),
  promoCode: z.string().min(1).max(64).optional(),
});

/** paymentMethodRef is the token from the provider's hosted card field; card numbers never reach us. */
export const checkoutSchema = z.object({
  planCode: z.string().min(1),
  promoCode: z.string().trim().min(1).max(64).optional(),
  paymentMethodRef: z.string().min(1).max(200),
});
export const paymentMethodSchema = z.object({ paymentMethodRef: z.string().min(1).max(200) });

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  description: z.string(),
  status: z.enum(['open', 'paid', 'void']),
  periodStart: z.string(),
  periodEnd: z.string(),
  subtotal: money,
  discount: money,
  total: money,
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

export const membershipViewSchema = z.object({
  id: z.uuid(),
  advisorId: z.uuid(),
  status: z.enum(['pending', 'active', 'past_due', 'cancelled']),
  plan: planSchema,
  promoCode: z.string().nullable(),
  hasPaymentMethod: z.boolean(),
  applicationAccepted: z.boolean(),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  quote: quoteSchema,
  invoices: z.array(invoiceSchema),
});

export const promoCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,64}$/),
    kind: z.enum(['percent_off', 'amount_off', 'waiver']),
    percentBps: z.number().int().min(1).max(10000).optional(),
    amount: money.optional(),
    description: z.string().max(500).optional(),
    expiresAt: z.iso.datetime().optional(),
    maxRedemptions: z.number().int().positive().optional(),
  })
  .refine((v) => v.kind !== 'percent_off' || v.percentBps !== undefined, {
    message: 'percentBps is required',
    path: ['percentBps'],
  })
  .refine((v) => v.kind !== 'amount_off' || v.amount !== undefined, {
    message: 'amount is required',
    path: ['amount'],
  });
