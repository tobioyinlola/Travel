'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  ListRow,
  PageHeader,
  StatusBadge,
  TextArea,
} from '@/components/ui';
import { api, ApiError, call, formatMoney, newKey } from '@/lib/api';
import { Banknote, FileSpreadsheet } from 'lucide-react';

const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.problem.title}. ${e.problem.detail ?? ''}` : 'Something went wrong';

/** Finance console (FR-ADM-05): supplier statements, variances, payout runs and the ledger check. */
export default function FinancePage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries();
  const onError = (e: unknown) => setError(errText(e));

  const recon = useQuery({
    queryKey: ['recon'],
    queryFn: () => call(api.GET('/v1/finance/reconciliation')),
    retry: false,
  });
  const trial = useQuery({
    queryKey: ['trial'],
    queryFn: () => call(api.GET('/v1/finance/ledger/trial-balance')),
  });
  const mismatches = useQuery({
    queryKey: ['mismatches'],
    queryFn: () =>
      call(api.GET('/v1/finance/statement-lines', { params: { query: { status: 'mismatch' } } })),
  });
  const unmatched = useQuery({
    queryKey: ['unmatched'],
    queryFn: () =>
      call(api.GET('/v1/finance/statement-lines', { params: { query: { status: 'unmatched' } } })),
  });
  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => call(api.GET('/v1/finance/payout-runs')),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: () => call(api.GET('/v1/auth/me')) });

  const importStatement = useMutation({
    mutationFn: (b: { supplier: string; reference: string; csv: string }) =>
      call(
        api.POST('/v1/finance/statements', {
          params: { header: { 'Idempotency-Key': newKey() } },
          body: { ...b, currency: 'USD' },
        }),
      ),
    onSuccess: async (r) => {
      setNotice(
        `Imported ${r.lines} lines: ${r.matched} matched, ${r.mismatch} with a variance, ${r.unmatched} not found.`,
      );
      await refresh();
    },
    onError,
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; decision: 'accept' | 'reject' }) =>
      call(
        api.POST('/v1/finance/statement-lines/{id}/resolve', {
          params: { path: { id: v.id }, header: { 'Idempotency-Key': newKey() } },
          body: {
            decision: v.decision,
            note:
              v.decision === 'accept'
                ? 'Accepted the supplier amount'
                : 'Disputed with the supplier',
          },
        }),
      ),
    onSuccess: refresh,
    onError,
  });
  const createRun = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/finance/payout-runs', {
          params: { header: { 'Idempotency-Key': newKey() } },
        }),
      ),
    onSuccess: refresh,
    onError,
  });
  const approve = useMutation({
    mutationFn: (id: string) =>
      call(
        api.POST('/v1/finance/payout-runs/{id}/approve', {
          params: { path: { id }, header: { 'Idempotency-Key': newKey() } },
        }),
      ),
    onSuccess: refresh,
    onError,
  });
  const cancelRun = useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/v1/finance/payout-runs/{id}/cancel', { params: { path: { id } } })),
    onSuccess: refresh,
    onError,
  });

  function onImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const f = new FormData(e.currentTarget);
    importStatement.mutate({
      supplier: String(f.get('supplier')).trim(),
      reference: String(f.get('reference')).trim(),
      csv: String(f.get('csv')),
    });
  }

  if (recon.isPending) return <p className="text-muted">Loading…</p>;
  if (recon.isError) return <AccessNotice error={recon.error} />;
  const r = recon.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Finance" subtitle="Supplier statements, variances and payouts." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title="Reconciliation" action={<StatusBadge status={r.ok ? 'passed' : 'failed'} />}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted">Ledger balanced</dt>
            <dd className="text-lg">{r.ledgerBalanced ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-muted">Receivable variance</dt>
            <dd className="text-lg">
              {r.receivableVarianceMinor === '0' ? 'None' : r.receivableVarianceMinor}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Variances to decide</dt>
            <dd className="text-lg">{r.openMismatches}</dd>
          </div>
          <div>
            <dt className="text-muted">Lines not found</dt>
            <dd className="text-lg">{r.unmatchedLines}</dd>
          </div>
        </dl>
        {trial.data && (
          <p className="mt-3 text-xs text-muted">
            Ledger totals: debits {trial.data.totalDebit}, credits {trial.data.totalCredit} (minor
            units).
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Import a supplier statement">
          <form onSubmit={onImport} className="flex flex-col gap-3">
            <Field label="Supplier" name="supplier" required placeholder="fake-wholesaler-a" />
            <Field label="Statement reference" name="reference" required />
            <TextArea
              label="Lines: confirmation code, amount"
              name="csv"
              rows={6}
              required
              placeholder={'confirmation_code,amount\nABC1234,54.12'}
            />
            <Button type="submit" icon={FileSpreadsheet} disabled={importStatement.isPending}>
              Import and match
            </Button>
          </form>
        </Card>

        <Card title="Variances to decide">
          {mismatches.data?.items.length ? (
            <ul className="flex flex-col gap-2">
              {mismatches.data.items.map((l) => (
                <li key={l.id}>
                  <ListRow
                    tone="canvas"
                    icon={Banknote}
                    title={`${l.confirmationCode} · paid ${formatMoney(l.amount)}`}
                    subtitle={`Expected ${l.expected ? formatMoney(l.expected) : '—'} · variance ${l.variance ? formatMoney(l.variance) : '—'}`}
                    trailing={
                      <span className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => resolve.mutate({ id: l.id, decision: 'accept' })}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => resolve.mutate({ id: l.id, decision: 'reject' })}
                        >
                          Dispute
                        </Button>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No variances waiting.</Empty>
          )}
          {unmatched.data && unmatched.data.items.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-muted">Lines with no matching booking</p>
              <ul className="flex flex-col gap-1 text-sm">
                {unmatched.data.items.map((l) => (
                  <li key={l.id}>
                    {l.confirmationCode} · {formatMoney(l.amount)} · {l.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Payout runs"
        action={
          <Button onClick={() => createRun.mutate()} disabled={createRun.isPending}>
            Start a payout run
          </Button>
        }
      >
        {runs.data?.items.length ? (
          <ul className="flex flex-col gap-3">
            {runs.data.items.map((run) => {
              const mine = me.data ? run.approvedBy.includes(me.data.id) : false;
              return (
                <li key={run.id} className="rounded-[18px] bg-canvas p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      {new Date(run.createdAt).toLocaleString()} · {formatMoney(run.totalNet)} to
                      pay
                      {run.status === 'completed' && <> · {formatMoney(run.totalPaid)} sent</>}
                    </p>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted">
                        {run.approvedBy.length} of {run.approvalsNeeded} approvals
                      </span>
                      {run.status === 'draft' && (
                        <>
                          <Button
                            disabled={mine || approve.isPending}
                            onClick={() => approve.mutate(run.id)}
                          >
                            {mine ? 'You approved' : 'Approve'}
                          </Button>
                          <Button variant="ghost" onClick={() => cancelRun.mutate(run.id)}>
                            Cancel
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-col gap-1 text-sm">
                    {run.payouts.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-muted">Advisor {p.advisorId.slice(0, 8)}</span>
                        <span>
                          {formatMoney(p.net)}
                          {p.debtApplied.amountMinor !== '0' && (
                            <span className="text-muted">
                              {' '}
                              (after {formatMoney(p.debtApplied)} clawback)
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={p.status} />
                          {p.skipReason && (
                            <span className="text-xs text-muted">
                              {p.skipReason.replace(/_/g, ' ')}
                            </span>
                          )}
                          {p.failureReason && (
                            <span className="text-xs text-danger">
                              {p.failureReason.replace(/_/g, ' ')}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No payout runs yet.</Empty>
        )}
        <p className="mt-3 text-xs text-muted">
          Two different people must approve a run before any money moves. Advisors on hold, without
          a payout account, not active, or owed under $10 are skipped.
        </p>
      </Card>
    </div>
  );
}
