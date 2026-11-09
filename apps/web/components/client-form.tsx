'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from './ui';
import { ApiError, toMajor, toMinor } from '@/lib/api';

const STYLES = [
  'boutique',
  'luxury',
  'resort',
  'business',
  'family',
  'eco',
  'all_inclusive',
  'villa',
] as const;
type Style = (typeof STYLES)[number];

type Money = { amountMinor: string; currency: string };
export interface ClientValues {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  homeCity?: string | null;
  notes?: string;
  preferences?: {
    budgetPerNight?: { min?: Money; max?: Money };
    hotelStyles?: Style[];
    dietary?: string[];
    accessibility?: string;
    loyalty?: Array<{ program: string; number: string }>;
    travelPace?: 'relaxed' | 'balanced' | 'packed';
    other?: string;
  };
}

/** Create and edit form for a client profile and preferences (FR-CRM-01, FR-CRM-02). */
export function ClientForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ClientValues;
  submitLabel: string;
  onSubmit: (v: ClientValues) => Promise<void>;
}) {
  const p = initial?.preferences ?? {};
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [loyalty, setLoyalty] = useState(p.loyalty ?? []);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const currency = s('currency').toUpperCase() || 'USD';
    try {
      const budget: { min?: Money; max?: Money } = {};
      if (s('budgetMin')) budget.min = { amountMinor: toMinor(s('budgetMin'), currency), currency };
      if (s('budgetMax')) budget.max = { amountMinor: toMinor(s('budgetMax'), currency), currency };
      const styles = STYLES.filter((x) => f.get(`style_${x}`) === 'on');
      const dietary = s('dietary')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const pace = s('travelPace') as 'relaxed' | 'balanced' | 'packed' | '';
      const values: ClientValues = {
        firstName: s('firstName'),
        lastName: s('lastName'),
        email: s('email') || null,
        phone: s('phone') || null,
        dateOfBirth: s('dateOfBirth') || null,
        homeCity: s('homeCity') || null,
        notes: s('notes'),
        preferences: {
          ...(budget.min || budget.max ? { budgetPerNight: budget } : {}),
          ...(styles.length ? { hotelStyles: styles } : {}),
          ...(dietary.length ? { dietary } : {}),
          ...(s('accessibility') ? { accessibility: s('accessibility') } : {}),
          ...(loyalty.filter((l) => l.program && l.number).length
            ? { loyalty: loyalty.filter((l) => l.program && l.number) }
            : {}),
          ...(pace ? { travelPace: pace } : {}),
          ...(s('other') ? { other: s('other') } : {}),
        },
      };
      setBusy(true);
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err);
      } else setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const budgetCurrency =
    p.budgetPerNight?.min?.currency ?? p.budgetPerNight?.max?.currency ?? 'USD';
  return (
    <form onSubmit={handle} className="flex flex-col gap-6" noValidate>
      {error && <Alert>{error}</Alert>}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Contact</legend>
        <Field
          label="First name"
          name="firstName"
          defaultValue={initial?.firstName}
          required
          error={fieldErrors?.fieldError('firstName')}
        />
        <Field
          label="Last name"
          name="lastName"
          defaultValue={initial?.lastName}
          required
          error={fieldErrors?.fieldError('lastName')}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={initial?.email ?? ''}
          error={fieldErrors?.fieldError('email')}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={initial?.phone ?? ''}
          hint="International format, e.g. +2348012345678"
          error={fieldErrors?.fieldError('phone')}
        />
        <Field
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          defaultValue={initial?.dateOfBirth ?? ''}
        />
        <Field label="Home city" name="homeCity" defaultValue={initial?.homeCity ?? ''} />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Budget per night</legend>
        <Field
          label="Minimum"
          name="budgetMin"
          inputMode="decimal"
          defaultValue={
            p.budgetPerNight?.min ? toMajor(p.budgetPerNight.min.amountMinor, budgetCurrency) : ''
          }
        />
        <Field
          label="Maximum"
          name="budgetMax"
          inputMode="decimal"
          defaultValue={
            p.budgetPerNight?.max ? toMajor(p.budgetPerNight.max.amountMinor, budgetCurrency) : ''
          }
        />
        <Field label="Currency" name="currency" maxLength={3} defaultValue={budgetCurrency} />
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">Hotel style</legend>
        <div className="flex flex-wrap gap-4">
          {STYLES.map((x) => (
            <label key={x} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={`style_${x}`}
                defaultChecked={p.hotelStyles?.includes(x)}
              />{' '}
              {x.replace('_', ' ')}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Needs</legend>
        <Field
          label="Dietary needs"
          name="dietary"
          defaultValue={p.dietary?.join(', ') ?? ''}
          hint="Comma separated"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="travelPace" className="text-sm font-medium">
            Travel pace
          </label>
          <select
            id="travelPace"
            name="travelPace"
            defaultValue={p.travelPace ?? ''}
            className="rounded-md border border-gray-300 bg-surface px-3 py-2"
          >
            <option value="">Not set</option>
            <option value="relaxed">Relaxed</option>
            <option value="balanced">Balanced</option>
            <option value="packed">Packed</option>
          </select>
        </div>
        <Field
          label="Accessibility needs"
          name="accessibility"
          defaultValue={p.accessibility ?? ''}
        />
        <Field label="Other preferences" name="other" defaultValue={p.other ?? ''} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Loyalty programmes</legend>
        {loyalty.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <Field
              label="Programme"
              value={l.program}
              onChange={(e) =>
                setLoyalty(loyalty.map((x, j) => (j === i ? { ...x, program: e.target.value } : x)))
              }
            />
            <Field
              label="Number"
              value={l.number}
              onChange={(e) =>
                setLoyalty(loyalty.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLoyalty(loyalty.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => setLoyalty([...loyalty, { program: '', number: '' }])}
        >
          Add programme
        </Button>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={initial?.notes ?? ''}
          maxLength={10000}
          className="rounded-md border border-gray-300 px-3 py-2"
        />
      </div>
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
