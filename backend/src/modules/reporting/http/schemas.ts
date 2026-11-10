import { z } from 'zod';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const period = z.object({ from: z.iso.datetime(), to: z.iso.datetime() });

export const periodQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

export const advisorReportSchema = z.object({
  period,
  pipeline: z.object({
    proposalsSent: z.number().int(),
    proposalsApproved: z.number().int(),
    approvalRatePercent: z.number().int(),
  }),
  bookings: z.object({
    confirmed: z.number().int(),
    cancelled: z.number().int(),
    net: z.number().int(),
    value: money,
  }),
  commission: z.object({ earned: money, payable: money, paid: money }),
  tier: z.object({
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
  }),
  topSuppliers: z.array(z.object({ supplier: z.string(), hotels: z.number().int(), value: money })),
});

export const financeReportSchema = z.object({
  period,
  commission: z.object({
    recognized: money,
    advisorShare: money,
    platformShare: money,
    reversed: money,
    receivedFromSuppliers: money,
    madePayable: money,
    paidToAdvisors: money,
    outstanding: money,
  }),
  bySupplier: z.array(z.object({ supplier: z.string(), recognized: money, received: money })),
});

export const platformReportSchema = z.object({
  period,
  activation: z.object({
    applied: z.number().int(),
    approved: z.number().int(),
    active: z.number().int(),
    booked: z.number().int(),
    medianDaysActiveToFirstBooking: z.number().nullable(),
  }),
  activeAdvisors: z.number().int(),
  bookings: z.object({
    confirmed: z.number().int(),
    cancelled: z.number().int(),
    failed: z.number().int(),
    gmv: money,
    proposalToBookingPercent: z.number().int(),
  }),
  bySupplier: z.array(z.object({ supplier: z.string(), hotels: z.number().int(), value: money })),
});
