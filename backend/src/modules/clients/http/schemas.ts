import { z } from 'zod';
import { preferencesSchema } from '../domain/preferences.js';

const name = z.string().trim().min(1).max(100);
const date = z.iso.date();
const phone = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +2348012345678');

export const clientCreateSchema = z.object({
  firstName: name,
  lastName: name,
  email: z.email().max(254).nullable().optional(),
  phone: phone.nullable().optional(),
  dateOfBirth: date.nullable().optional(),
  homeCity: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(10000).optional(),
  preferences: preferencesSchema.optional(),
});
export const clientUpdateSchema = clientCreateSchema
  .partial()
  .extend({ version: z.number().int().positive() });
export const companionSchema = z.object({
  firstName: name,
  lastName: name,
  relationship: z.string().trim().min(1).max(50),
  dateOfBirth: date.nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export const clientListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export const privacyRequestSchema = z.object({
  kind: z.enum(['export', 'delete']),
  note: z.string().trim().max(2000).default(''),
});

export const clientSummarySchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  homeCity: z.string().nullable(),
  status: z.enum(['active', 'archived', 'erased']),
  updatedAt: z.string(),
});
export const clientSchema = clientSummarySchema.extend({
  dateOfBirth: z.string().nullable(),
  notes: z.string(),
  preferences: preferencesSchema,
  version: z.number(),
  createdAt: z.string(),
  companions: z.array(
    z.object({
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      relationship: z.string(),
      dateOfBirth: z.string().nullable(),
      notes: z.string(),
    }),
  ),
  trips: z.array(
    z.object({
      tripId: z.uuid(),
      title: z.string(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      status: z.string(),
      bookingIds: z.array(z.string()),
    }),
  ),
  privacyRequests: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['export', 'delete']),
      status: z.string(),
      createdAt: z.string(),
      dueAt: z.string(),
      completedAt: z.string().nullable(),
    }),
  ),
});
export const privacyRequestRowSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  advisorId: z.uuid(),
  clientName: z.string(),
  kind: z.enum(['export', 'delete']),
  status: z.string(),
  requesterNote: z.string(),
  verificationNote: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  createdAt: z.string(),
  dueAt: z.string(),
  completedAt: z.string().nullable(),
  hasExport: z.boolean(),
});
