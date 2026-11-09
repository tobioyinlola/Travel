import { z } from 'zod';

const money = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

/** FR-CRM-02: what an advisor needs to recommend well. Free text is bounded; lists are capped. */
export const preferencesSchema = z
  .object({
    budgetPerNight: z
      .object({ min: money.optional(), max: money.optional() })
      .refine((b) => !b.min || !b.max || b.min.currency === b.max.currency, {
        message: 'Use one currency',
      })
      .refine((b) => !b.min || !b.max || BigInt(b.min.amountMinor) <= BigInt(b.max.amountMinor), {
        message: 'Minimum is above maximum',
      })
      .optional(),
    hotelStyles: z
      .array(
        z.enum([
          'boutique',
          'luxury',
          'resort',
          'business',
          'family',
          'eco',
          'all_inclusive',
          'villa',
        ]),
      )
      .max(8)
      .optional(),
    dietary: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    accessibility: z.string().trim().max(1000).optional(),
    loyalty: z
      .array(
        z.object({
          program: z.string().trim().min(1).max(80),
          number: z.string().trim().min(1).max(40),
        }),
      )
      .max(20)
      .optional(),
    travelPace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
    other: z.string().trim().max(2000).optional(),
  })
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;
