import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Decision } from './decision';

// Proposal links carry a secret token: never index them, never cache them publicly.
export const metadata: Metadata = {
  title: 'Your trip proposal',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const API =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Money = { amountMinor: string; currency: string };
type Proposal = {
  version: number;
  status: 'published' | 'approved' | 'changes_requested' | 'declined' | 'superseded';
  title: string;
  startDate: string;
  endDate: string;
  clientFirstName: string;
  advisorName: string;
  items: Array<{
    id: string;
    kind: string;
    day: string;
    title: string;
    details: string;
    startTime: string | null;
    price: Money | null;
    hotel: null | {
      name: string;
      address: string;
      starRating: number;
      photo: string | null;
      checkIn: string;
      checkOut: string;
      nights: number;
      roomName: string;
      board: string;
      refundable: boolean;
      cancellationPolicy: string;
      total: Money;
      taxes: Money;
      feesAtHotel: Money;
      perks: Array<{ description: string }>;
    };
  }>;
  totals: { total: Money; taxesIncluded: Money; planningFee: Money; payableAtProperty: Money };
  ratesCheckedAt: string;
  ratesExpired: boolean;
  decidedAt: string | null;
  decidedByName: string | null;
};

function money(m: Money): string {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: m.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('en', { style: 'currency', currency: m.currency }).format(
    Number(m.amountMinor) / 10 ** digits,
  );
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
const BOARD: Record<string, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  all_inclusive: 'All inclusive',
};

async function load(token: string): Promise<{ proposal: Proposal } | { error: number }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const res = await fetch(`${API}/v1/proposal-links/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  });
  if (!res.ok) return { error: res.status };
  return { proposal: (await res.json()) as Proposal };
}

/** Server-rendered for fast first load on phones (NFR-02); no account needed (FR-TRV-01). */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);
  if ('error' in result) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Trip proposal</h1>
        <p className="mt-2 text-muted">
          {result.error === 410
            ? 'This link has expired. Please ask your advisor for a new one.'
            : 'This link is not valid. Please ask your advisor for a new one.'}
        </p>
      </>
    );
  }
  const p = result.proposal;
  const byDay = new Map<string, Proposal['items']>();
  for (const it of p.items) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);

  return (
    <article className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">
          Prepared for {p.clientFirstName} by {p.advisorName}
        </p>
        <h1 className="text-3xl font-semibold">{p.title}</h1>
        <p className="mt-1 text-muted">
          {longDate(p.startDate)} to {longDate(p.endDate)}
        </p>
      </header>

      {[...byDay.entries()].map(([day, items]) => (
        <section key={day} aria-label={longDate(day)} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{longDate(day)}</h2>
          {items.map((it) => (
            <div key={it.id} className="rounded-lg border border-gray-200 bg-surface p-4">
              {it.hotel ? (
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-medium">
                    {it.hotel.name}{' '}
                    <span
                      className="text-sm text-muted"
                      aria-label={`${it.hotel.starRating} stars`}
                    >
                      {'★'.repeat(Math.round(it.hotel.starRating))}
                    </span>
                  </p>
                  <p className="text-sm text-muted">{it.hotel.address}</p>
                  <p className="text-sm">
                    {it.hotel.roomName} · {BOARD[it.hotel.board] ?? it.hotel.board} ·{' '}
                    {it.hotel.nights} night{it.hotel.nights === 1 ? '' : 's'} ({it.hotel.checkIn} to{' '}
                    {it.hotel.checkOut})
                  </p>
                  {it.hotel.perks.length > 0 && (
                    <p className="text-sm text-green-900">
                      Included with this booking:{' '}
                      {it.hotel.perks.map((x) => x.description).join(' · ')}
                    </p>
                  )}
                  <p className="text-sm">
                    <strong>{money(it.hotel.total)}</strong> including {money(it.hotel.taxes)} taxes
                    {it.hotel.feesAtHotel.amountMinor !== '0' && (
                      <>; plus {money(it.hotel.feesAtHotel)} paid at the hotel</>
                    )}
                  </p>
                  <p className="text-xs text-muted">{it.hotel.cancellationPolicy}</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">
                    {it.startTime && <span className="mr-2 text-muted">{it.startTime}</span>}
                    {it.title}
                  </p>
                  {it.details && <p className="text-sm text-muted">{it.details}</p>}
                  {it.price && <p className="text-sm">{money(it.price)}</p>}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <section aria-label="Price" className="rounded-lg border border-gray-200 bg-surface p-5">
        <h2 className="text-lg font-semibold">Total {money(p.totals.total)}</h2>
        <p className="text-sm text-muted">
          Includes {money(p.totals.taxesIncluded)} taxes
          {p.totals.planningFee.amountMinor !== '0' && (
            <> and a {money(p.totals.planningFee)} planning fee</>
          )}
          .
          {p.totals.payableAtProperty.amountMinor !== '0' && (
            <> {money(p.totals.payableAtProperty)} is paid directly at the hotels.</>
          )}
        </p>
        <p className="mt-2 text-xs text-muted">
          Prices last checked {new Date(p.ratesCheckedAt).toUTCString()}.
        </p>
      </section>

      <Decision
        token={token}
        status={p.status}
        ratesExpired={p.ratesExpired}
        advisorName={p.advisorName}
        decidedByName={p.decidedByName}
      />
    </article>
  );
}
