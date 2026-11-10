import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { newId } from '../../shared-kernel/index.js';
import { matchLine, parseStatementCsv, type StatementLineInput } from '../domain/statements.js';
import { CommissionService } from './commission.service.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

const m = (minor: string | bigint, currency: string) => ({ amountMinor: String(minor), currency });

interface LineRow {
  id: string;
  statement_id: string;
  supplier: string;
  confirmation_code: string;
  amount_minor: string;
  currency: string;
  status: string;
  commission_id: string | null;
  expected_minor: string | null;
  variance_minor: string | null;
  note: string | null;
}

const lineView = (l: LineRow) => ({
  id: l.id,
  statementId: l.statement_id,
  supplier: l.supplier,
  confirmationCode: l.confirmation_code,
  amount: m(l.amount_minor, l.currency),
  status: l.status,
  commissionId: l.commission_id,
  expected: l.expected_minor === null ? null : m(l.expected_minor, l.currency),
  variance: l.variance_minor === null ? null : m(l.variance_minor, l.currency),
  note: l.note,
});

/**
 * Supplier commission statements (FR-COM-04): import, match each line to a commission by supplier and the
 * hotel's confirmation code, settle exact matches, and queue everything else for a person. Also the daily
 * reconciliation: ledger = commissions = statements, alert on any variance (ARCH SLO "ledger variance = 0").
 */
@Injectable()
export class StatementsService implements OnModuleInit {
  private readonly logger = new Logger('Reconciliation');

  constructor(
    private readonly db: Database,
    private readonly commissions: CommissionService,
    private readonly audit: AuditWriter,
    private readonly jobs: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs.register<Record<string, never>>({
      name: 'commission.reconcile-daily',
      module: 'commission-payments',
      queue: 'default',
      cron: '30 2 * * *',
      handle: async () => {
        const r = await this.reconciliation();
        if (!r.ok)
          this.logger.error(
            `Reconciliation variance: ledger balanced=${r.ledgerBalanced}, receivable variance=${r.receivableVarianceMinor}, open mismatches=${r.openMismatches}`,
          );
      },
    });
  }

  async import(
    actorId: string,
    input: {
      supplier: string;
      reference: string;
      currency: string;
      csv?: string;
      lines?: Array<{ confirmationCode: string; amount: string }>;
    },
  ) {
    let lines: StatementLineInput[];
    try {
      lines = input.csv
        ? parseStatementCsv(input.csv)
        : (input.lines ?? []).map(
            (l) => parseStatementCsv(`${l.confirmationCode},${l.amount}`)[0]!,
          );
    } catch (e) {
      throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'statement-invalid', (e as Error).message);
    }
    if (lines.length === 0)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'statement-invalid',
        'The statement has no lines',
      );
    const total = lines.reduce((n, l) => n + l.amountMinor, 0n);
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          input.supplier,
          input.reference,
          input.currency,
          lines.map((l) => [l.confirmationCode, String(l.amountMinor)]),
        ]),
      )
      .digest('hex');

    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      const statementId = newId();
      const inserted = await tx.query(
        `INSERT INTO commission.statements (id, supplier, reference, currency, total_minor, file_hash, imported_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (file_hash) DO NOTHING RETURNING id`,
        [statementId, input.supplier, input.reference, input.currency, total, hash, actorId],
      );
      if (inserted.length === 0)
        throw problem(
          HttpStatus.CONFLICT,
          'statement-already-imported',
          'This statement was already imported',
        );
      const counts = { matched: 0, mismatch: 0, unmatched: 0 };
      for (const l of lines) {
        const lineId = newId();
        const c = await this.commissions.findForStatement(tx, input.supplier, l.confirmationCode);
        const open = c && ['expected', 'invoiced', 'received'].includes(c.status) ? c : null;
        const outcome = matchLine(l.amountMinor, open ? BigInt(open.expected_minor) : null);
        let note: string | null = null;
        if (!open)
          note = c ? `Commission is already ${c.status}` : 'No booking with this confirmation code';
        const status = outcome.kind === 'matched' ? 'matched' : outcome.kind;
        if (status === 'matched') counts.matched += 1;
        else if (status === 'mismatch') counts.mismatch += 1;
        else counts.unmatched += 1;
        await tx.query(
          `INSERT INTO commission.statement_lines (id, statement_id, supplier, confirmation_code, amount_minor, currency, status,
              commission_id, expected_minor, variance_minor, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            lineId,
            statementId,
            input.supplier,
            l.confirmationCode,
            l.amountMinor,
            input.currency,
            status,
            open?.id ?? null,
            open?.expected_minor ?? null,
            outcome.kind === 'mismatch'
              ? outcome.varianceMinor
              : outcome.kind === 'matched'
                ? 0n
                : null,
            note,
          ],
        );
        if (open && outcome.kind === 'matched') {
          await this.commissions.settle(tx, open.id, l.amountMinor, actorId, 'statement');
          await tx.publish({
            type: 'SupplierPaymentReceived',
            version: 1,
            payload: {
              statementLineId: lineId,
              supplier: input.supplier,
              bookingId: open.booking_id,
              amount: m(l.amountMinor, input.currency),
            },
          });
        }
      }
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'statement.imported',
        entityType: 'statement',
        entityId: statementId,
        module: 'commission-payments',
        metadata: { supplier: input.supplier, reference: input.reference, ...counts },
      });
      return { statementId, lines: lines.length, ...counts, total: m(total, input.currency) };
    });
  }

  /** Finance decides what to do with a line whose amount differs from what we expected. */
  async resolve(lineId: string, actorId: string, decision: 'accept' | 'reject', note: string) {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      const [l] = await tx.query<LineRow>(
        `SELECT * FROM commission.statement_lines WHERE id = $1 FOR UPDATE`,
        [lineId],
      );
      if (!l) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Statement line not found');
      if (l.status !== 'mismatch' || !l.commission_id)
        throw problem(
          HttpStatus.CONFLICT,
          'line-not-resolvable',
          'Only a line with a variance can be resolved',
        );
      if (decision === 'accept')
        await this.commissions.settle(
          tx,
          l.commission_id,
          BigInt(l.amount_minor),
          actorId,
          'variance_accepted',
        );
      await tx.query(
        `UPDATE commission.statement_lines SET status = $2, resolved_by = $3, resolved_at = now(), note = $4 WHERE id = $1`,
        [lineId, decision === 'accept' ? 'resolved' : 'rejected', actorId, note],
      );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: `statement.line_${decision === 'accept' ? 'accepted' : 'rejected'}`,
        entityType: 'statement_line',
        entityId: lineId,
        module: 'commission-payments',
        metadata: { varianceMinor: l.variance_minor, note },
      });
      return lineView({ ...l, status: decision === 'accept' ? 'resolved' : 'rejected', note });
    });
  }

  async lines(q: { status?: string | undefined }) {
    const rows = await this.db.read<LineRow>(
      'commission-payments',
      `SELECT id, statement_id, supplier, confirmation_code, amount_minor, currency, status, commission_id, expected_minor, variance_minor, note
         FROM commission.statement_lines WHERE ($1::text IS NULL OR status = $1) ORDER BY statement_id DESC, confirmation_code LIMIT 500`,
      [q.status ?? null],
    );
    return { items: rows.map(lineView) };
  }

  async statements() {
    const rows = await this.db.read<{
      id: string;
      supplier: string;
      reference: string;
      currency: string;
      total_minor: string;
      imported_at: Date;
      matched: string;
      mismatch: string;
      unmatched: string;
    }>(
      'commission-payments',
      `SELECT s.id, s.supplier, s.reference, s.currency, s.total_minor, s.imported_at,
              count(*) FILTER (WHERE l.status IN ('matched', 'resolved'))::text AS matched,
              count(*) FILTER (WHERE l.status = 'mismatch')::text AS mismatch,
              count(*) FILTER (WHERE l.status = 'unmatched')::text AS unmatched
         FROM commission.statements s LEFT JOIN commission.statement_lines l ON l.statement_id = s.id
        GROUP BY s.id ORDER BY s.imported_at DESC LIMIT 100`,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        supplier: r.supplier,
        reference: r.reference,
        total: m(r.total_minor, r.currency),
        importedAt: r.imported_at.toISOString(),
        matched: Number(r.matched),
        mismatches: Number(r.mismatch),
        unmatched: Number(r.unmatched),
      })),
    };
  }

  /**
   * Ledger = commissions = statements. The ledger's receivable must equal the expected commission still waiting
   * for a supplier; anything else is a bug. Open mismatches and unmatched lines are work for finance.
   */
  async reconciliation() {
    // The commissions table is row-level secured by advisor; finance reads all rows.
    const { bal, recv, open, overdue } = await this.db.transaction(
      'commission-payments',
      async (tx) => {
        await tx.setLocal('atp.scope', 'all');
        const [bal] = await tx.query<{ d: string; c: string }>(
          `SELECT coalesce(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS d,
                coalesce(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS c FROM commission.ledger_entries`,
        );
        const [recv] = await tx.query<{ ledger: string; commissions: string }>(
          `SELECT (SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END), 0)
                   FROM commission.ledger_entries WHERE account = 'supplier_receivable')::text AS ledger,
                (SELECT coalesce(sum(expected_minor), 0) FROM commission.commissions
                  WHERE status IN ('expected', 'invoiced', 'received'))::text AS commissions`,
        );
        const [open] = await tx.query<{ mismatches: string; unmatched: string }>(
          `SELECT count(*) FILTER (WHERE status = 'mismatch')::text AS mismatches,
                count(*) FILTER (WHERE status = 'unmatched')::text AS unmatched FROM commission.statement_lines`,
        );
        const [overdue] = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM commission.commissions
          WHERE status = 'expected' AND check_out < current_date - 30`,
        );
        return { bal: bal!, recv: recv!, open: open!, overdue: overdue! };
      },
    );
    const variance = BigInt(recv.ledger) - BigInt(recv.commissions);
    const ledgerBalanced = bal.d === bal.c;
    return {
      ledgerBalanced,
      receivableVarianceMinor: String(variance),
      openMismatches: Number(open.mismatches),
      unmatchedLines: Number(open.unmatched),
      overdueCommissions: Number(overdue.n),
      ok: ledgerBalanced && variance === 0n,
    };
  }
}
