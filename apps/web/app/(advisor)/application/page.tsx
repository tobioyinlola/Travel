'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Select, StatusBadge } from '@/components/ui';
import { api, ApiError, call, formatMoney, newKey } from '@/lib/api';

type Application = Awaited<ReturnType<typeof loadApplication>>;
type AppData = NonNullable<Application>;

async function loadApplication() {
  const res = await api.GET('/v1/advisor-application');
  if (res.response.status === 404) return null;
  return call(Promise.resolve(res));
}

async function loadMembership() {
  const res = await api.GET('/v1/membership');
  if (res.response.status === 404) return null;
  return call(Promise.resolve(res));
}

const STATUS_COPY: Record<string, string> = {
  applied: 'Complete the steps below so we can review your application.',
  under_review: 'Your application is with our review team.',
  approved: 'You are approved. Complete the Essentials course to unlock booking.',
  active: 'Your account is active.',
  rejected: 'We were not able to accept your application.',
  suspended: 'Your account is suspended. Contact support.',
  offboarded: 'This account is closed.',
};

export default function ApplicationPage() {
  const qc = useQueryClient();
  const application = useQuery({
    queryKey: ['application'],
    queryFn: loadApplication,
    refetchInterval: 4000,
  });
  const [editing, setEditing] = useState(false);

  if (application.isPending) return <p className="text-muted">Loading…</p>;
  const app = application.data;
  const showForm = !app || editing || Boolean(app.infoRequestNote && app.status === 'applied');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your application</h1>
        {app && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-muted">
            <StatusBadge status={app.status} /> {STATUS_COPY[app.status]}
            {app.status === 'approved' && (
              <a className="text-brand-700 underline" href="/learn/essentials">
                Start Essentials
              </a>
            )}
          </p>
        )}
      </div>
      {app?.infoRequestNote && app.status === 'applied' && (
        <Alert kind="info">
          <strong>Our review team asked:</strong> {app.infoRequestNote}
        </Alert>
      )}
      {showForm ? (
        <ApplicationForm
          initial={app ?? null}
          onDone={async () => {
            setEditing(false);
            await qc.invalidateQueries({ queryKey: ['application'] });
          }}
        />
      ) : (
        app && (
          <Checks
            app={app}
            onEdit={app.status === 'applied' ? () => setEditing(true) : undefined}
          />
        )
      )}
      {app && app.status !== 'rejected' && app.status !== 'offboarded' && <MembershipSection />}
    </div>
  );
}

function ApplicationForm({
  initial,
  onDone,
}: {
  initial: AppData | null;
  onDone: () => Promise<void>;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const submit = useMutation({
    mutationFn: async (f: FormData) => {
      const s = (k: string) => String(f.get(k) ?? '').trim();
      return call(
        api.POST('/v1/advisor-application', {
          body: {
            legalName: s('legalName'),
            country: s('country'),
            taxResidency: s('taxResidency'),
            experience: s('experience') as 'none' | 'some' | 'professional',
            niche: s('niche'),
            address: {
              line1: s('line1'),
              ...(s('line2') ? { line2: s('line2') } : {}),
              city: s('city'),
              ...(s('region') ? { region: s('region') } : {}),
              ...(s('postalCode') ? { postalCode: s('postalCode') } : {}),
            },
          },
        }),
      );
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    submit.mutate(new FormData(e.currentTarget));
  }

  const a = initial?.address;
  return (
    <Card title={initial ? 'Update your application' : 'Tell us about you'}>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error.message}</Alert>
          </div>
        )}
        <Field
          label="Legal name"
          name="legalName"
          defaultValue={initial?.legalName}
          autoComplete="name"
          required
          error={error?.fieldError('legalName')}
        />
        <Field
          label="Country (2 letters)"
          name="country"
          defaultValue={initial?.country}
          maxLength={2}
          required
          hint="e.g. NG, US, GB"
          error={error?.fieldError('country')}
        />
        <Field
          label="Address line 1"
          name="line1"
          defaultValue={a?.line1}
          autoComplete="address-line1"
          required
          error={error?.fieldError('address.line1')}
        />
        <Field
          label="Address line 2"
          name="line2"
          defaultValue={a?.line2}
          autoComplete="address-line2"
        />
        <Field
          label="City"
          name="city"
          defaultValue={a?.city}
          autoComplete="address-level2"
          required
          error={error?.fieldError('address.city')}
        />
        <Field
          label="Region / state"
          name="region"
          defaultValue={a?.region}
          autoComplete="address-level1"
        />
        <Field
          label="Postal code"
          name="postalCode"
          defaultValue={a?.postalCode}
          autoComplete="postal-code"
        />
        <Field
          label="Tax residency (2 letters)"
          name="taxResidency"
          defaultValue={initial?.taxResidency}
          maxLength={2}
          required
          error={error?.fieldError('taxResidency')}
        />
        <Select
          label="Travel industry experience"
          name="experience"
          defaultValue={initial?.experience ?? 'none'}
        >
          <option value="none">None, I am new to this</option>
          <option value="some">Some</option>
          <option value="professional">Professional</option>
        </Select>
        <Field
          label="Your niche"
          name="niche"
          defaultValue={initial?.niche}
          required
          hint="e.g. family beach holidays, African safaris"
          error={error?.fieldError('niche')}
        />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : 'Submit application'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Checks({ app, onEdit }: { app: AppData; onEdit?: (() => void) | undefined }) {
  return (
    <Card title="Steps">
      <ol className="flex flex-col gap-4">
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>1. Application submitted</span>
          <span className="flex items-center gap-3">
            <StatusBadge status="passed" />
            {onEdit && (
              <Button variant="secondary" onClick={onEdit}>
                Edit
              </Button>
            )}
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>2. Verify your identity</span>
          <span className="flex items-center gap-3">
            <StatusBadge status={app.kyc.status} />
            {app.kyc.redirectUrl && (
              <a className="text-brand-700 underline" href={app.kyc.redirectUrl}>
                Start verification
              </a>
            )}
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>3. Sign the independent contractor agreement</span>
          <span className="flex items-center gap-3">
            <StatusBadge status={app.agreement.status} />
            {app.agreement.signingUrl && (
              <a className="text-brand-700 underline" href={app.agreement.signingUrl}>
                Review and sign
              </a>
            )}
          </span>
        </li>
      </ol>
      {app.kyc.status === 'not_started' && (
        <p className="mt-3 text-sm text-muted">Preparing your verification and agreement…</p>
      )}
    </Card>
  );
}

function MembershipSection() {
  const qc = useQueryClient();
  const membership = useQuery({
    queryKey: ['membership'],
    queryFn: loadMembership,
    refetchInterval: 4000,
  });
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => call(api.GET('/v1/membership/plans')),
  });
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState('pm_fake_visa');

  const checkout = useMutation({
    mutationFn: (f: FormData) =>
      call(
        api.POST('/v1/membership/checkout', {
          params: { header: { 'Idempotency-Key': newKey() } },
          body: {
            planCode: String(f.get('planCode')),
            ...(String(f.get('promoCode') ?? '').trim()
              ? { promoCode: String(f.get('promoCode')).trim() }
              : {}),
            paymentMethodRef: card,
          },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['membership'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });
  const updateCard = useMutation({
    mutationFn: () =>
      call(
        api.PUT('/v1/membership/payment-method', {
          params: { header: { 'Idempotency-Key': newKey() } },
          body: { paymentMethodRef: card },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['membership'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  const m = membership.data;
  const failed = m?.invoices.find((i) => i.status === 'open' && i.lastError);

  const cardPicker = (
    <Select label="Card (test mode)" value={card} onChange={(e) => setCard(e.target.value)}>
      <option value="pm_fake_visa">Visa ending 4242 (succeeds)</option>
      <option value="pm_fake_declined">Card that is declined</option>
    </Select>
  );

  return (
    <Card title="Membership">
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!m ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            checkout.mutate(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted">
            Choose a plan. We charge your card only once your application is accepted.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Plan</legend>
            {plans.data?.map((p, i) => (
              <label key={p.code} className="flex items-center gap-2">
                <input type="radio" name="planCode" value={p.code} defaultChecked={i === 0} />
                {p.name}: {formatMoney(p.price)} per {p.billingPeriod}
              </label>
            ))}
          </fieldset>
          <Field label="Promo code (optional)" name="promoCode" autoComplete="off" />
          {cardPicker}
          <p className="text-xs text-muted">
            Test mode: no real card is charged. Card details are entered on the payment
            provider&apos;s page in production.
          </p>
          <Button type="submit" disabled={checkout.isPending}>
            Save plan and card
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2">
            <StatusBadge status={m.status} /> {m.plan.name}, {formatMoney(m.quote.total)}
            {m.quote.discount.amountMinor !== '0' && (
              <span className="text-sm text-muted">
                (after {formatMoney(m.quote.discount)} discount)
              </span>
            )}
          </p>
          {m.status === 'pending' && !m.applicationAccepted && (
            <p className="text-sm text-muted">
              We will charge your card when your application is accepted.
            </p>
          )}
          {m.currentPeriodEnd && (
            <p className="text-sm text-muted">
              {m.cancelAtPeriodEnd ? 'Ends' : 'Paid through'}{' '}
              {new Date(m.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          {failed && (
            <div className="flex flex-col gap-3">
              <Alert>
                Your payment did not go through ({failed.lastError?.replace(/_/g, ' ')}). Choose
                another card.
              </Alert>
              {cardPicker}
              <Button onClick={() => updateCard.mutate()} disabled={updateCard.isPending}>
                Retry payment
              </Button>
            </div>
          )}
          {m.invoices.length > 0 && (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2">Invoice</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {m.invoices.map((i) => (
                  <tr key={i.id} className="border-b border-gray-100">
                    <td className="py-2 font-mono">{i.number}</td>
                    <td>{formatMoney(i.total)}</td>
                    <td>
                      <StatusBadge status={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
