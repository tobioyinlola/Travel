'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Star } from 'lucide-react';
import { useState } from 'react';
import { DateRange } from './date-range';
import { Alert, Button, Card, Flag, Select } from './ui';
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
  verb = 'Add',
  title = 'Add a hotel',
}: {
  trip: {
    startDate: string;
    endDate: string;
    adults: number;
    childrenAges: number[];
    currency: string;
  };
  onAdd: (rateKey: string) => Promise<void>;
  /** Button word and card title, e.g. "Switch to" when changing an existing stay. */
  verb?: string;
  title?: string;
}) {
  const [params, setParams] = useState<SearchParams | null>(null);
  const [destination, setDestination] = useState('');
  const [stay, setStay] = useState({ start: trip.startDate, end: trip.endDate });
  const [minStars, setMinStars] = useState('');
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
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

  function search() {
    setError(null);
    setParams({
      destination: destination || dests.data?.[0]?.slug || '',
      checkIn: stay.start,
      checkOut: stay.end,
      adults: trip.adults,
      ...(trip.childrenAges.length ? { childrenAges: trip.childrenAges.join(',') } : {}),
      currency: trip.currency,
      ...(minStars ? { minStars: Number(minStars) } : {}),
      ...(preferredOnly ? { preferredOnly: 'true' as const } : {}),
    });
  }

  async function add(rateKey: string) {
    setError(null);
    setAdding(rateKey);
    try {
      await onAdd(rateKey);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add this room');
    } finally {
      setAdding(null);
    }
  }

  const party = `${trip.adults} adult${trip.adults === 1 ? '' : 's'}${trip.childrenAges.length ? `, children aged ${trip.childrenAges.join(', ')}` : ''}`;
  return (
    <Card title={title}>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Select
            label="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {dests.data?.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select label="Stars" value={minStars} onChange={(e) => setMinStars(e.target.value)}>
            <option value="">Any</option>
            <option value="4">4+</option>
            <option value="5">5</option>
          </Select>
        </div>
        <DateRange
          label="Stay"
          start={stay.start}
          end={stay.end}
          min={trip.startDate}
          max={trip.endDate}
          onChange={(start, end) => setStay({ start, end })}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preferredOnly}
            onChange={(e) => setPreferredOnly(e.target.checked)}
            className="h-4 w-4 accent-[#1472d6]"
          />{' '}
          Preferred partners only
        </label>
        <Button icon={Search} variant="dark" onClick={search}>
          Search hotels
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        For {party}, priced in {trip.currency}.
      </p>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {results.isFetching && (
        <p className="mt-4 text-muted" aria-live="polite">
          Searching suppliers…
        </p>
      )}
      {results.isError && (
        <div className="mt-3">
          <Alert>
            {results.error instanceof ApiError ? results.error.message : 'Search failed'}
          </Alert>
        </div>
      )}
      {results.data && (
        <div className="mt-6 flex flex-col gap-4">
          {results.data.warnings.length > 0 && (
            <Alert kind="info">
              Some suppliers did not respond, so results may be incomplete. Try again shortly.
            </Alert>
          )}
          {results.data.results.length === 0 && <p className="text-muted">No rooms match.</p>}
          {results.data.results.map((r) => (
            <article key={r.property.id} className="rounded-[24px] bg-canvas p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-surface text-xl">
                    <Flag code={r.property.countryCode} />
                  </span>
                  <div>
                    <h3 className="text-lg">{r.property.name}</h3>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <span aria-label={`${r.property.starRating} stars`} className="inline-flex">
                        {Array.from({ length: Math.round(r.property.starRating) }, (_, i) => (
                          <Star
                            key={i}
                            size={12}
                            strokeWidth={1.5}
                            className="fill-ink text-ink"
                            aria-hidden
                          />
                        ))}
                      </span>
                      {r.property.address}
                    </p>
                  </div>
                </div>
                <p className="text-right text-sm text-muted">
                  from{' '}
                  <span className="text-2xl font-light text-ink">{formatMoney(r.fromNightly)}</span>{' '}
                  / night
                </p>
              </div>
              {r.preferred && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white">
                    {r.preferred.programName}
                  </span>
                  <span className="text-muted">
                    {r.preferred.perks.map((p) => p.description).join(' · ')}
                  </span>
                </p>
              )}
              <ul className="mt-3 flex flex-col gap-2">
                {r.rates.map((rate) => (
                  <li
                    key={rate.rateKey}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[18px] bg-surface p-3 sm:grid-cols-[1.4fr_1.4fr_1fr_auto]"
                  >
                    <span>
                      <span className="block text-sm">{rate.roomName}</span>
                      <span className="block text-xs text-muted">{BOARD[rate.board]}</span>
                    </span>
                    <span className="hidden text-xs text-muted sm:block">
                      {rate.refundable
                        ? `Free cancellation until ${rate.freeCancellationUntil?.slice(0, 10)}`
                        : 'Non-refundable'}
                      {rate.partnerEligible && <span className="text-accent-deep"> · perks</span>}
                    </span>
                    <span className="hidden sm:block">
                      <span className="block text-sm">{formatMoney(rate.total)}</span>
                      <span className="block text-xs text-muted">
                        ~{(rate.commissionBps / 100).toFixed(0)}% commission
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      icon={Plus}
                      className="h-10 px-4 text-sm"
                      disabled={adding !== null}
                      onClick={() => add(rate.rateKey)}
                      aria-label={`${verb} ${rate.roomName}, ${BOARD[rate.board]}, ${formatMoney(rate.total)}`}
                    >
                      {adding === rate.rateKey ? 'Working…' : verb}
                    </Button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
