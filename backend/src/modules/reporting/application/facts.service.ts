import { Injectable, OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@atp/contracts';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';

interface Fact {
  kind: string;
  advisorId?: string | null;
  subjectId?: string | null;
  supplier?: string | null;
  amountMinor?: string | number | bigint;
  currency?: string | null;
  props?: Record<string, unknown>;
}

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Turns events into facts (the funnel event schema, FR-RPT-06). Each mapping is explicit so the schema is easy to
 * read and to document in docs/FUNNEL_EVENTS.md. Handlers are idempotent: the fact's primary key is the event id.
 */
const STATUS_KINDS: Record<string, string> = {
  approved: 'advisor_approved',
  active: 'advisor_active',
  suspended: 'advisor_suspended',
  offboarded: 'advisor_offboarded',
};

const MAPPINGS: Array<{ event: string; facts: (p: P) => Fact[] }> = [
  {
    event: 'AdvisorApplicationSubmitted',
    facts: (p) => [{ kind: 'application_submitted', advisorId: p.advisorId }],
  },
  {
    event: 'AdvisorStatusChanged',
    facts: (p) => {
      const kind = STATUS_KINDS[p.to as string];
      return kind ? [{ kind, advisorId: p.advisorId, props: { from: p.from } }] : [];
    },
  },
  {
    event: 'ProposalPublished',
    facts: (p) => [
      {
        kind: 'proposal_published',
        advisorId: p.advisorId,
        subjectId: p.proposalId,
        props: { version: p.proposalVersion },
      },
    ],
  },
  {
    event: 'ProposalApproved',
    facts: (p) => [
      {
        kind: 'proposal_approved',
        advisorId: p.advisorId,
        subjectId: p.proposalId,
        props: { hotels: p.hotels?.length ?? 0 },
      },
    ],
  },
  {
    event: 'BookingConfirmed',
    facts: (p) => [
      {
        kind: 'booking_confirmed',
        advisorId: p.advisorId,
        subjectId: p.bookingId,
        amountMinor: p.total?.amountMinor ?? 0,
        currency: p.total?.currency ?? null,
      },
      ...((p.lines ?? []) as P[]).map((l) => ({
        kind: 'booking_line_confirmed',
        advisorId: p.advisorId as string,
        subjectId: (l.lineId ?? p.bookingId) as string,
        supplier: l.supplier as string,
        amountMinor: l.total.amountMinor as string,
        currency: l.total.currency as string,
        props: { bookingId: p.bookingId, commissionable: l.commissionable?.amountMinor ?? '0' },
      })),
    ],
  },
  {
    event: 'BookingCancelled',
    facts: (p) => [
      {
        kind: 'booking_cancelled',
        advisorId: p.advisorId,
        subjectId: p.bookingId,
        amountMinor: p.refund?.amountMinor ?? 0,
        currency: p.refund?.currency ?? null,
        props: { penalty: p.penalty?.amountMinor ?? '0' },
      },
    ],
  },
  {
    event: 'BookingFailed',
    facts: (p) => [
      {
        kind: 'booking_failed',
        advisorId: p.advisorId,
        subjectId: p.bookingId,
        props: { reason: p.reason },
      },
    ],
  },
  {
    event: 'CommissionRecognized',
    facts: (p) => [
      {
        kind: 'commission_recognized',
        advisorId: p.advisorId,
        subjectId: p.commissionId,
        supplier: p.supplier,
        amountMinor: p.advisorShare.amountMinor, // the advisor's share; the whole and the platform's share are in props
        currency: p.advisorShare.currency,
        props: {
          expected: p.expected.amountMinor,
          platformShare: p.platformShare.amountMinor,
          commissionable: p.commissionable.amountMinor,
          tier: p.tierCode,
        },
      },
    ],
  },
  {
    event: 'CommissionReleased',
    facts: (p) => [
      {
        kind: 'commission_released',
        advisorId: p.advisorId,
        subjectId: p.commissionId,
        amountMinor: p.amount.amountMinor,
        currency: p.amount.currency,
      },
    ],
  },
  {
    event: 'CommissionReversed',
    facts: (p) => [
      {
        kind: 'commission_reversed',
        advisorId: p.advisorId,
        subjectId: p.commissionId,
        amountMinor: p.advisorShare.amountMinor,
        currency: p.advisorShare.currency,
        props: { wasPayable: p.wasPayable },
      },
    ],
  },
  {
    event: 'SupplierPaymentReceived',
    facts: (p) => [
      {
        kind: 'supplier_payment_received',
        subjectId: p.statementLineId,
        supplier: p.supplier ?? null,
        amountMinor: p.amount.amountMinor,
        currency: p.amount.currency,
      },
    ],
  },
  {
    event: 'PayoutPaid',
    facts: (p) => [
      {
        kind: 'payout_paid',
        advisorId: p.advisorId,
        subjectId: p.payoutId,
        amountMinor: p.amount.amountMinor,
        currency: p.amount.currency,
      },
    ],
  },
];

@Injectable()
export class FactsService implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    for (const m of MAPPINGS) {
      this.bus.subscribe<P>({
        module: 'reporting',
        handler: `reporting.fact.${m.event}`,
        event: m.event,
        version: 1,
        queue: 'bulk',
        handle: async (e, tx) => {
          let n = 0;
          for (const f of m.facts(e.payload)) await this.insert(tx, e, f, n++);
        },
      });
    }
  }

  /** The event id is the key; events that make several facts add a suffix to the id's last digits. */
  private async insert(tx: Tx, e: EventEnvelope, f: Fact, n: number): Promise<void> {
    await tx.query(
      `INSERT INTO reporting.facts (event_id, kind, advisor_id, subject_id, supplier, amount_minor, currency, props, occurred_at)
       VALUES (reporting.fact_id($1::uuid, $2), $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (event_id) DO NOTHING`,
      [
        e.id,
        n,
        f.kind,
        f.advisorId ?? null,
        f.subjectId ?? null,
        f.supplier ?? null,
        f.amountMinor ?? 0,
        f.currency ?? null,
        JSON.stringify(f.props ?? {}),
        e.occurredAt,
      ],
    );
  }
}
