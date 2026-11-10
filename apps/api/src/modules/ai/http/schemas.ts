import { z } from 'zod';

const confidence = z.enum(['high', 'medium', 'low']);
const flag = z.object({
  sentence: z.string(),
  kind: z.enum(['price', 'policy', 'perk']),
  reason: z.string(),
});
const source = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  /** Used in the answer; `index` is its [n] marker. */
  cited: z.boolean(),
  index: z.number().int().nullable(),
});

export const askSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  clientId: z.uuid().optional(),
});
export const answerSchema = z.object({
  id: z.uuid(),
  answer: z.string(),
  confidence,
  sources: z.array(source),
  /** Claims the assistant could not verify (prices, policies, perks): check before telling a client. */
  flags: z.array(flag),
});

export const draftCreateSchema = z.object({
  kind: z.enum(['client_message', 'trip_summary']).default('client_message'),
  instruction: z.string().trim().min(3).max(1000),
  clientId: z.uuid().optional(),
});
export const draftSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  clientId: z.uuid().nullable(),
  instruction: z.string(),
  text: z.string(),
  edited: z.boolean(),
  status: z.enum(['draft', 'approved', 'rejected']),
  sources: z.array(source),
  flags: z.array(flag),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export const draftListSchema = z.object({ items: z.array(draftSchema) });
export const draftApproveSchema = z.object({ text: z.string().trim().min(1).max(5000).optional() });

export const historySchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['ask', 'draft']),
      prompt: z.string(),
      output: z.string(),
      confidence,
      sources: z.array(z.string()),
      toolCalls: z.array(z.object({ name: z.string(), resultCount: z.number().int() })),
      flagCount: z.number().int(),
      model: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const settingsSchema = z.object({ enabled: z.boolean(), useClientNotes: z.boolean() });
export const reindexResultSchema = z.object({ queued: z.boolean() });
