import { z } from 'zod';

/**
 * Every domain event travels in this envelope (ARCH "How modules communicate", rule 4):
 * immutable, past tense, versioned, carries identifiers only.
 */
export const eventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  producer: z.string().min(1),
  correlationId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope<TType extends string = string, TPayload = Record<string, unknown>> = {
  id: string;
  type: TType;
  version: number;
  occurredAt: string;
  producer: string;
  correlationId: string | null;
  payload: TPayload;
};
