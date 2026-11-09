'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Select } from './ui';
import { api, ApiError, call, formatMoney } from '@/lib/api';

type SearchParams = {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenAges?: string;
  currency: string;
  minStars?: number;
  preferredOnly?: 'true';
};

const BOARD: Record<string, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  all_inclusive: 'All inclusive',
};

/** Destination search with live rates; "Add" puts the offer on the trip (FR-INV-04/05/06). */
export function HotelSearch({
  trip,
  onAdd,
}: {
  trip: {
    startDate: string;
    endDate: string;
    adults: number;
    childrenAges: number[];
    currency: string;
  };
  onAdd: (rateKey: string) => Promise<void>;
}) {
  const [params, setParams] = useState<SearchParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dests = useQuery({
    queryKey: ['destinations'],
    queryFn: () => call(api.GET('/v1/catalog/destinations')),
  });
  const results = useQuery({
    queryKey: ['hotel-search', params],
    queryFn: () => call(api.GET('/v1/catalog/search', { params: { query: params! } })),
    enabled: Boolean(params),
    retry: false,
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '');
    setParams({
      destination: s('destination'),
      checkIn: s('checkIn'),
      checkOut: s('checkOut'),
      adults: trip.adults,
      ...(trip.childrenAges.length ? { childrenAges: trip.childrenAges.join(',') } : {}),
      currency: trip.currency,
      ...(s('minStars') ? { minStars: Number(s('minStars')) } : {}),
      ...(f.get('preferredOnly') === 'on' ? { preferredOnly: 'true' as const } : {}),
    });
  }

  async function add(rateKey: string) {
    setError(null);
    try {
      await onAdd(rateKey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add this room');
    }
  }

  const party = `${trip.adults} adult${trip.adults === 1 ? '' : 's'}${trip.childrenAges.length ? `, children aged ${trip.childrenAges.join(', ')}` : ''}`;
  return (
    <Card title="Add a hotel">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <Select label="Destination" name="destination">
          {dests.data?.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </Select>
        <Field
          label="Check-in"
          name="checkIn"
          type="date"
          defaultValue={trip.startDate}
          min={trip.startDate}
          max={trip.endDate}
          required
        />
        <Field
          label="Check-out"
          name="checkOut"
          type="date"
          defaultValue={trip.endDate}
          min={trip.startDate}
          max={trip.endDate}
          required
        />
        <Select label="Stars" name="minStars" defaultValue="">
          <option value="">Any</option>
          <option value="4">4+</option>
          <option value="5">5</option>
        </Select>
        <Button type="submit">Search</Button>
        <label className="flex items-center gap-2 text-sm sm:col-span-5">
          <input type="checkbox" name="preferredOnly" /> Preferred partners only
        </label>
      </form>
      <p className="mt-2 text-xs text-muted">
        For {party}, priced in {trip.currency}.
      </p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {results.isFetching && <p className="mt-4 text-muted">Searching suppliers…</p>}
      {results.isError && (
        <div className="mt-3">
          <Alert>
            {results.error instanceof ApiError ? results.error.message : 'Search failed'}
          </Alert>
        </div>
      )}
      {results.data && (
        <div className="mt-4 flex flex-col gap-4">
          {results.data.warnings.length > 0 && (
            <Alert kind="info">
              Some suppliers did not respond, so results may be incomplete. Try again shortly.
            </Alert>
          )}
          {results.data.results.length === 0 && <p className="text-muted">No rooms match.</p>}
          {results.data.results.map((r) => (
            <div key={r.property.id} className="rounded-md border border-gray-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {r.property.name}{' '}
                    <span className="text-sm text-muted">
                      {'★'.repeat(Math.round(r.property.starRating))}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{r.property.address}</p>
                </div>
                <p className="text-sm">
                  from <strong>{formatMoney(r.fromNightly)}</strong> / night
                </p>
              </div>
              {r.preferred && (
                <p className="mt-2 text-sm text-green-900">
                  <span className="mr-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium">
                    {r.preferred.programName}
                  </span>
                  {r.preferred.perks.map((p) => p.description).join(' · ')}
                </p>
              )}
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Rooms at {r.property.name}</caption>
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-1">Room</th>
                    <th>Terms</th>
                    <th>Total</th>
                    <th>Commission</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.rates.map((rate) => (
                    <tr key={rate.rateKey} className="border-t border-gray-100">
                      <td className="py-2">
                        {rate.roomName}
                        <br />
                        <span className="text-xs text-muted">{BOARD[rate.board]}</span>
                      </td>
                      <td className="text-xs">
                        {rate.refundable
                          ? `Free cancellation until ${rate.freeCancellationUntil?.slice(0, 10)}`
                          : 'Non-refundable'}
                        {rate.partnerEligible && (
                          <span className="ml-1 text-green-900">· perks</span>
                        )}
                      </td>
                      <td>
                        {formatMoney(rate.total)}
                        <br />
                        <span className="text-xs text-muted">
                          incl. {formatMoney(rate.taxes)} taxes
                        </span>
                      </td>
                      <td className="text-xs">~{(rate.commissionBps / 100).toFixed(0)}%</td>
                      <td className="text-right">
                        <Button variant="secondary" onClick={() => add(rate.rateKey)}>
                          Add
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
