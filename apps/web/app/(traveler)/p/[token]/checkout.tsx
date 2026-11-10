'use client';

import { CreditCard } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Field, StatusBadge, TextArea } from '@/components/ui';
import { api, ApiError, call, formatMoney, newKey } from '@/lib/api';

export type CheckoutView = {
  status: string;
  currency: string;
  total: { amountMinor: string; currency: string };
  lines: Array<{
    id: string;
    propertyName: string;
    checkIn: string;
    checkOut: string;
    status: string;
    confirmationCode: string | null;
  }>;
  paymentOptions: Array<{ mode: string; dueNow: { amountMinor: string; currency: string } }>;
  selected: { mode: string } | null;
  traveler: { name: string; email: string; phone: string | null } | null;
  payment: {
    state: string;
    amount: { amountMinor: string; currency: string } | null;
    clientToken: string | null;
    failure: string | null;
  };
  failureReason: string | null;
};

const MODE_LABEL: Record<string, [string, string]> = {
  pay_at_hotel: ['Pay at the hotel', 'Nothing is charged now.'],
  prepay: ['Pay in full now', 'The whole amount is charged to your card now.'],
  deposit: ['Pay a deposit now', 'A deposit is charged now; the rest is paid at the hotel.'],
};

const problemText = (e: unknown) =>
  e instanceof ApiError
    ? `${e.problem.title}. ${e.problem.detail ?? ''}`
    : 'Something went wrong. Please try again.';

/** Details, payment and confirmation after the traveler approves (FR-BKG-02/03, FR-TRV-03). */
export function Checkout({
  token,
  initial,
  suggestedName,
  advisorName,
}: {
  token: string;
  initial: CheckoutView;
  suggestedName: string | null;
  advisorName: string;
}) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(initial.selected?.mode ?? initial.paymentOptions[0]?.mode ?? '');
  const [card, setCard] = useState('');

  // While something is happening elsewhere (payment provider, hotels), keep the page current.
  const waiting =
    (view.status === 'draft' && view.payment.state === 'awaiting') || view.status === 'pending';
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(async () => {
      try {
        setView(
          (await call(
            api.GET('/v1/checkout/{token}', { params: { path: { token } } }),
          )) as CheckoutView,
        );
      } catch {
        /* keep the last view; the next tick tries again */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [waiting, token]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    setError(null);
    setBusy(true);
    try {
      setView(
        (await call(
          api.POST('/v1/checkout/{token}/confirm', {
            params: { path: { token }, header: { 'Idempotency-Key': newKey() } },
            body: {
              paymentMode: mode as 'prepay',
              traveler: {
                name: s('name'),
                email: s('email'),
                ...(s('phone') ? { phone: s('phone') } : {}),
                ...(s('requests') ? { specialRequests: s('requests') } : {}),
              },
            },
          }),
        )) as CheckoutView,
      );
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  async function payNow(e: FormEvent) {
    e.preventDefault();
    if (!view.payment.clientToken) return;
    setError(null);
    setBusy(true);
    try {
      const res = await call(
        api.POST('/v1/dev/fake-payments/{clientToken}/pay', {
          params: { path: { clientToken: view.payment.clientToken } },
          body: { cardNumber: card },
        }),
      );
      if (res.status === 'declined')
        setError('Your card was declined. Please check the details or try another card.');
      setView(
        (await call(
          api.GET('/v1/checkout/{token}', { params: { path: { token } } }),
        )) as CheckoutView,
      );
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  const due = view.selected
    ? view.paymentOptions.find((o) => o.mode === view.selected?.mode)?.dueNow
    : null;

  if (view.status === 'confirmed' || view.status === 'completed')
    return (
      <section className="flex flex-col gap-3 rounded-[28px] bg-surface p-6" aria-label="Booking">
        <Alert kind="success">Your trip is booked. We have emailed you the details.</Alert>
        <ul className="flex flex-col gap-2">
          {view.lines.map((l) => (
            <li key={l.id} className="rounded-[18px] bg-canvas p-3 text-sm">
              <p className="text-base">{l.propertyName}</p>
              <p className="text-muted">
                {l.checkIn} to {l.checkOut}
              </p>
              <p className="mt-1">
                Confirmation number: <strong className="font-medium">{l.confirmationCode}</strong>
              </p>
            </li>
          ))}
        </ul>
      </section>
    );
  if (view.status === 'failed')
    return (
      <Alert>
        We could not complete your booking{view.failureReason ? ` (${view.failureReason})` : ''}.
        Anything you paid is being refunded. {advisorName} will contact you with an updated
        proposal.
      </Alert>
    );
  if (view.status === 'cancelled') return <Alert kind="info">This booking was cancelled.</Alert>;
  if (view.status === 'pending')
    return (
      <Alert kind="info">
        {view.payment.state === 'captured' ? 'Payment received. ' : ''}Booking your hotels… this
        usually takes a few seconds.
      </Alert>
    );

  // Draft with a payment open.
  if (view.payment.state === 'awaiting') {
    return (
      <form onSubmit={payNow} className="flex flex-col gap-4 rounded-[28px] bg-surface p-6">
        <h2 className="text-lg font-normal">Pay securely</h2>
        {error && <Alert>{error}</Alert>}
        {!view.payment.clientToken ? (
          <Alert kind="info">Preparing a secure payment…</Alert>
        ) : (
          <>
            <p>
              Amount due now:{' '}
              <strong className="text-xl font-normal">
                {view.payment.amount ? formatMoney(view.payment.amount) : ''}
              </strong>
            </p>
            {/* Stands in for the payment provider's hosted card fields (card data never reaches our servers). */}
            <Alert kind="info">
              Test mode: use card 4242 4242 4242 4242 to succeed, or 4000 0000 0000 0002 to be
              declined.
            </Alert>
            <Field
              label="Card number"
              name="card"
              inputMode="numeric"
              autoComplete="cc-number"
              required
              value={card}
              onChange={(e) => setCard(e.target.value)}
            />
            <Button type="submit" icon={CreditCard} disabled={busy || card.length < 12}>
              Pay now
            </Button>
          </>
        )}
      </form>
    );
  }

  const noOptions = view.paymentOptions.length === 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-[28px] bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-normal">Complete your booking</h2>
        <StatusBadge status={view.status} />
      </div>
      <p className="text-sm text-muted">
        Approved. Add the lead traveler&apos;s details and choose how to pay. Prices are checked
        again with the hotels before anything is charged.
      </p>
      {view.payment.state === 'failed' && (
        <Alert>
          Your last payment did not go through ({view.payment.failure ?? 'declined'}). You can try
          again.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      <Field
        label="Lead traveler's full name"
        name="name"
        autoComplete="name"
        required
        minLength={2}
        defaultValue={view.traveler?.name ?? suggestedName ?? ''}
      />
      <Field
        label="Email for confirmations"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={view.traveler?.email ?? ''}
      />
      <Field
        label="Phone (optional)"
        name="phone"
        type="tel"
        autoComplete="tel"
        defaultValue={view.traveler?.phone ?? ''}
      />
      <TextArea label="Special requests (optional)" name="requests" rows={3} maxLength={500} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">How would you like to pay?</legend>
        {noOptions && (
          <Alert kind="info">
            These hotels need different payment terms, so {advisorName} will finish this booking
            with you.
          </Alert>
        )}
        {view.paymentOptions.map((o) => (
          <label
            key={o.mode}
            className={`flex cursor-pointer items-start gap-3 rounded-[18px] p-4 ${mode === o.mode ? 'bg-canvas ring-2 ring-accent' : 'bg-canvas'}`}
          >
            <input
              type="radio"
              name="mode"
              className="mt-1"
              checked={mode === o.mode}
              onChange={() => setMode(o.mode)}
            />
            <span>
              <span className="block">
                {MODE_LABEL[o.mode]?.[0] ?? o.mode} ·{' '}
                {o.mode === 'pay_at_hotel' ? 'no charge today' : formatMoney(o.dueNow)}
              </span>
              <span className="block text-sm text-muted">{MODE_LABEL[o.mode]?.[1]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={busy || noOptions || !mode}>
        {mode === 'pay_at_hotel' ? 'Book now' : 'Continue to payment'}
      </Button>
      {due && mode !== 'pay_at_hotel' && (
        <p className="text-xs text-muted">You will see the amount again before paying.</p>
      )}
    </form>
  );
}
