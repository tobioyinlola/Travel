'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { API_BASE_URL, api, ApiError, call, formatMoney, newKey } from '@/lib/api';
import { Alert, Button, Card, Field, StatusBadge, TextArea } from './ui';

const MODE: Record<string, string> = {
  pay_at_hotel: 'Pay at hotel',
  prepay: 'Paid in full',
  deposit: 'Deposit',
};
const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.problem.title}. ${e.problem.detail ?? ''}` : 'Something went wrong';

/** The booking behind an approved proposal: status, confirmations, payment, and cancel with the penalty shown. */
export function BookingCard({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const key = ['bookings', tripId];
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);

  const q = useQuery({
    queryKey: key,
    queryFn: () => call(api.GET('/v1/bookings', { params: { query: { tripId } } })),
    // Live updates come over the stream below; polling is only a safety net if it is blocked.
    refetchInterval: (query) => {
      const b = query.state.data?.items[0];
      const moving = b && (b.status === 'pending' || b.cancelling || b.paymentState === 'awaiting');
      return moving ? 15000 : false;
    },
  });
  const b = q.data?.items[0];
  const perks = useQuery({
    queryKey: ['booking-perks', b?.id],
    enabled:
      Boolean(b) &&
      (b?.status === 'confirmed' || b?.status === 'modified' || b?.status === 'completed'),
    queryFn: () =>
      call(
        api.GET('/v1/partners/booking-perks/{bookingId}', {
          params: { path: { bookingId: b!.id } },
        }),
      ),
  });
  const quote = useQuery({
    queryKey: ['booking-quote', b?.id],
    enabled: cancelling && Boolean(b),
    queryFn: () =>
      call(api.GET('/v1/bookings/{id}/cancellation-quote', { params: { path: { id: b!.id } } })),
  });
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API_BASE_URL}/v1/bookings/stream`, { withCredentials: true });
    es.addEventListener('booking', (e) => {
      try {
        if (JSON.parse((e as MessageEvent).data).tripId === tripId) {
          void qc.invalidateQueries({ queryKey: key });
          void qc.invalidateQueries({ queryKey: ['trip', tripId] });
        }
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [tripId]);

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['trip', tripId] });
  };
  const discard = useMutation({
    mutationFn: () => call(api.DELETE('/v1/bookings/{id}', { params: { path: { id: b!.id } } })),
    onSuccess: refreshAll,
    onError: (e) => setError(errText(e)),
  });
  const modify = useMutation({
    mutationFn: (body: {
      name?: string;
      email?: string;
      phone?: string;
      specialRequests?: string;
    }) =>
      call(
        api.PATCH('/v1/bookings/{id}/guest', {
          params: { path: { id: b!.id }, header: { 'Idempotency-Key': newKey() } },
          body,
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      await refreshAll();
    },
    onError: (e) => setError(errText(e)),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      call(
        api.POST('/v1/bookings/{id}/cancel', {
          params: { path: { id: b!.id }, header: { 'Idempotency-Key': newKey() } },
          body: { reason },
        }),
      ),
    onSuccess: async () => {
      setCancelling(false);
      await refreshAll();
    },
    onError: (e) => setError(errText(e)),
  });

  if (!b) return null;
  const waiting =
    b.status === 'draft'
      ? b.paymentState === 'awaiting'
        ? 'The traveler is paying.'
        : 'Waiting for the traveler to add details and choose how to pay.'
      : b.status === 'pending'
        ? 'Booking the hotels with the suppliers…'
        : null;

  return (
    <Card title="Booking" action={<StatusBadge status={b.cancelling ? 'pending' : b.status} />}>
      <div className="flex flex-col gap-3 text-sm">
        {error && <Alert>{error}</Alert>}
        {b.modifying && <Alert kind="info">Telling the hotels about the change…</Alert>}
        {b.cancelling && <Alert kind="info">Cancelling with the hotels; the refund follows.</Alert>}
        {waiting && <p className="text-muted">{waiting}</p>}
        {b.failureReason && <Alert>{b.failureReason}</Alert>}
        <ul className="flex flex-col gap-2">
          {b.lines.map((l) => (
            <li key={l.id} className="rounded-[14px] bg-canvas p-3">
              <p className="flex items-center justify-between gap-2">
                <span className="text-base">{l.propertyName}</span>
                <StatusBadge status={l.status} />
              </p>
              <p className="text-muted">
                {l.checkIn} to {l.checkOut} · {formatMoney(l.total)}
              </p>
              {l.guestDetailsRefused && (
                <p className="text-danger">
                  This hotel did not accept the new guest details. Please contact them directly.
                </p>
              )}
              {perks.data?.items
                .filter((p) => p.lineId === l.id)
                .map((p) => (
                  <p key={p.programName} className="text-accent-deep">
                    {p.programName}: {p.perks.map((x) => x.description).join(' · ')}
                  </p>
                ))}
              {l.confirmationCode && (
                <p>
                  Confirmation: <strong className="font-medium">{l.confirmationCode}</strong>
                </p>
              )}
            </li>
          ))}
        </ul>
        {b.paymentMode && (
          <p className="text-muted">
            {MODE[b.paymentMode]} · paid {formatMoney(b.paid)}
            {b.refunded.amountMinor !== '0' && <>, refunded {formatMoney(b.refunded)}</>}
            {b.penalty.amountMinor !== '0' && <>, hotel penalty {formatMoney(b.penalty)}</>}
          </p>
        )}
        {b.traveler && (
          <p className="text-muted">
            Lead traveler: {b.traveler.name} ({b.traveler.email})
          </p>
        )}

        {b.status === 'confirmed' && !b.cancelling && !editing && !cancelling && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit guest details
          </Button>
        )}
        {editing && b.traveler && (
          <form
            className="flex flex-col gap-3 rounded-[14px] bg-canvas p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const f = new FormData(e.currentTarget);
              const v = (k: string) => String(f.get(k) ?? '').trim();
              const t = b.traveler!;
              const changes: Record<string, string> = {};
              if (v('name') !== t.name) changes.name = v('name');
              if (v('email') !== t.email) changes.email = v('email');
              if (v('phone') !== (t.phone ?? '')) changes.phone = v('phone');
              if (v('requests') !== (t.specialRequests ?? ''))
                changes.specialRequests = v('requests');
              if (Object.keys(changes).length === 0) return setEditing(false);
              modify.mutate(changes);
            }}
          >
            <Field
              label="Lead guest"
              name="name"
              defaultValue={b.traveler.name}
              required
              minLength={2}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={b.traveler.email}
              required
            />
            <Field label="Phone" name="phone" defaultValue={b.traveler.phone ?? ''} />
            <TextArea
              label="Special requests"
              name="requests"
              rows={2}
              defaultValue={b.traveler.specialRequests ?? ''}
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={modify.isPending}>
                Save and tell the hotels
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {b.status === 'draft' && (
          <Button variant="secondary" disabled={discard.isPending} onClick={() => discard.mutate()}>
            Change the plan instead
          </Button>
        )}

        {(b.status === 'confirmed' || b.status === 'modified') && !b.cancelling && !cancelling && (
          <Button variant="secondary" onClick={() => setCancelling(true)}>
            Cancel booking
          </Button>
        )}
        {cancelling && (
          <form
            className="flex flex-col gap-3 rounded-[14px] bg-canvas p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              cancel.mutate(String(new FormData(e.currentTarget).get('reason')).trim());
            }}
          >
            {quote.isPending && (
              <p className="text-muted">Checking the hotels’ cancellation terms…</p>
            )}
            {quote.data && (
              <>
                <p>
                  Estimated hotel penalty: <strong>{formatMoney(quote.data.penalty)}</strong>.
                  Refund to the traveler: <strong>{formatMoney(quote.data.refund)}</strong>.
                </p>
                <ul className="text-xs text-muted">
                  {quote.data.lines.map((l) => (
                    <li key={l.id}>
                      {l.propertyName}: {l.cancellationPolicy}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  The hotels confirm the final amount when they cancel.
                </p>
              </>
            )}
            <TextArea
              label="Reason"
              name="reason"
              rows={2}
              required
              minLength={2}
              maxLength={300}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={cancel.isPending || !quote.data}>
                Confirm cancellation
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
                Keep booking
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
