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
  Select,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError, call, newKey } from '@/lib/api';
import { UserRound } from 'lucide-react';

const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.problem.title}. ${e.problem.detail ?? ''}` : 'Something went wrong';

type Action = { id: string; kind: 'suspend' | 'reinstate' | 'offboard'; name: string };

/** Advisor lifecycle (FR-ADM-02): suspend, reinstate, offboard with a successor for open bookings. */
export default function AdvisorsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [successor, setSuccessor] = useState('');
  const list = useQuery({
    queryKey: ['admin-advisors'],
    queryFn: () => call(api.GET('/v1/admin/advisors', { params: { query: {} } })),
    retry: false,
  });

  const run = useMutation({
    mutationFn: async (v: { a: Action; reason: string; successor: string }) => {
      const params = { path: { id: v.a.id }, header: { 'Idempotency-Key': newKey() } };
      if (v.a.kind === 'suspend')
        return call(
          api.POST('/v1/admin/advisors/{id}/suspend', { params, body: { reason: v.reason } }),
        );
      if (v.a.kind === 'reinstate')
        return call(
          api.POST('/v1/admin/advisors/{id}/reinstate', { params, body: { reason: v.reason } }),
        );
      return call(
        api.POST('/v1/admin/advisors/{id}/offboard', {
          params,
          body: { reason: v.reason, ...(v.successor ? { reassignToAdvisorId: v.successor } : {}) },
        }),
      );
    },
    onSuccess: async (r) => {
      setNotice(
        'reassignedBookings' in r && r.reassignedBookings > 0
          ? `Done. ${r.reassignedBookings} open booking(s) moved to the new advisor.`
          : 'Done.',
      );
      setAction(null);
      setSuccessor('');
      await qc.invalidateQueries({ queryKey: ['admin-advisors'] });
    },
    onError: (e) => setError(errText(e)),
  });

  if (list.isPending) return <p className="text-muted">Loading…</p>;
  if (list.isError) return <AccessNotice error={list.error} />;
  const active = list.data.items.filter((a) => a.status === 'active');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const reason = String(new FormData(e.currentTarget).get('reason')).trim();
    run.mutate({ a: action!, reason, successor });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Advisors"
        subtitle="Suspend, reinstate or offboard. Offboarding moves open bookings to another advisor."
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      <Card title="Advisors">
        {list.data.items.length === 0 ? (
          <Empty>No advisors yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.data.items.map((a) => (
              <li key={a.id}>
                <ListRow
                  tone="canvas"
                  icon={UserRound}
                  title={a.legalName}
                  subtitle={`${a.country}${a.statusReason ? ` · ${a.statusReason}` : ''}`}
                  trailing={
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.status} />
                      {(a.status === 'active' || a.status === 'approved') && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setAction({ id: a.id, kind: 'suspend', name: a.legalName })
                          }
                        >
                          Suspend
                        </Button>
                      )}
                      {a.status === 'suspended' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setAction({ id: a.id, kind: 'reinstate', name: a.legalName })
                          }
                        >
                          Reinstate
                        </Button>
                      )}
                      {a.status !== 'offboarded' && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setAction({ id: a.id, kind: 'offboard', name: a.legalName })
                          }
                        >
                          Offboard
                        </Button>
                      )}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {action && (
        <Card
          title={`${action.kind === 'suspend' ? 'Suspend' : action.kind === 'reinstate' ? 'Reinstate' : 'Offboard'} ${action.name}`}
        >
          <form onSubmit={submit} className="flex flex-col gap-3">
            {error && <Alert>{error}</Alert>}
            <Field
              label="Reason (recorded in the audit log)"
              name="reason"
              required
              minLength={3}
              maxLength={500}
            />
            {action.kind === 'offboard' && (
              <Select
                label="Take over open bookings (needed if they have any)"
                value={successor}
                onChange={(e) => setSuccessor(e.target.value)}
              >
                <option value="">No one</option>
                {active
                  .filter((a) => a.id !== action.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.legalName}
                    </option>
                  ))}
              </Select>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={run.isPending}>
                Confirm
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                Cancel
              </Button>
            </div>
            {action.kind === 'offboard' && (
              <p className="text-xs text-muted">
                Offboarding is final. Their trips and clients on moved bookings go with the
                bookings; commission they already earned stays theirs and is still paid out.
              </p>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}
