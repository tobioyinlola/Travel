import { z } from 'zod';
import { passwordSchema } from '../domain/password.js';

const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const phone = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +2348012345678');
const country = z.string().regex(/^[A-Za-z]{2}$/, 'ISO 3166 two-letter country code');

export const registerSchema = z
  .object({
    email: email.optional(),
    phone: phone.optional(),
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => Boolean(v.email) !== Boolean(v.phone), {
    message: 'Provide an email or a phone number',
  });

export const verifySchema = z.object({ userId: z.uuid(), code: z.string().regex(/^\d{6}$/) });
export const resendSchema = z.object({ userId: z.uuid() });
export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});
export const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const mfaChallengeSchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide a code or a recovery code',
  });

const role = z.enum(['advisor', 'team_lead', 'supplier_manager', 'support', 'finance', 'admin']);
export const meSchema = z.object({
  id: z.uuid(),
  role,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  displayName: z.string().nullable(),
  mfaEnabled: z.boolean(),
  mfaVerified: z.boolean(),
  next: z.enum(['verify_contact', 'mfa_enroll', 'mfa_challenge']).nullable(),
});

export const registerResponseSchema = z.object({
  userId: z.uuid(),
  channel: z.enum(['email', 'sms']),
});
export const mfaEnrollResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  qrDataUrl: z.string(),
});
export const mfaConfirmResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });

export const applicationSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  country,
  address: z.object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
  }),
  taxResidency: country,
  experience: z.enum(['none', 'some', 'professional']),
  niche: z.string().trim().min(2).max(200),
});

const advisorStatus = z.enum([
  'applied',
  'under_review',
  'approved',
  'active',
  'suspended',
  'offboarded',
  'rejected',
]);
export const advisorSummarySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: advisorStatus,
  legalName: z.string(),
  country: z.string(),
  acceptedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  essentialsPassedAt: z.string().nullable(),
});
export const applicationViewSchema = advisorSummarySchema.extend({
  address: applicationSchema.shape.address,
  taxResidency: z.string(),
  experience: z.enum(['none', 'some', 'professional']),
  niche: z.string(),
  submittedAt: z.string(),
  infoRequestNote: z.string().nullable(),
  kyc: z.object({
    status: z.enum(['not_started', 'pending', 'passed', 'failed']),
    redirectUrl: z.string().nullable(),
    checkedAt: z.string().nullable(),
  }),
  agreement: z.object({
    status: z.enum(['not_sent', 'sent', 'signed', 'declined']),
    version: z.string().nullable(),
    signingUrl: z.string().nullable(),
    signedAt: z.string().nullable(),
    documentRef: z.string().nullable(),
  }),
});
export { advisorStatus };

export const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
});
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
