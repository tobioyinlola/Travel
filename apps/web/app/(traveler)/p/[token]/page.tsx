import type { Metadata } from 'next';
import { headers } from 'next/headers';
import {
  BedDouble,
  CalendarDays,
  Car,
  Gift,
  StickyNote,
  Ticket,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Checkout, type CheckoutView } from './checkout';
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
  travelers: { adults: number; childrenAges: number[] };
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
const short = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const BOARD: Record<string, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  all_inclusive: 'All inclusive',
};
const ICONS: Record<string, LucideIcon> = {
  hotel: BedDouble,
  activity: Ticket,
  transfer: Car,
  note: StickyNote,
};

function Tile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-canvas">
      <Icon size={20} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

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

async function loadCheckout(token: string): Promise<CheckoutView | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const res = await fetch(`${API}/v1/checkout/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  });
  return res.ok ? ((await res.json()) as CheckoutView) : null;
}

/** Server-rendered for fast first load on phones (NFR-02); no account needed (FR-TRV-01). */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);
  if ('error' in result) {
    return (
      <div className="rounded-[28px] bg-surface p-8">
        <h1 className="text-3xl font-normal tracking-tight">Trip proposal</h1>
        <p className="mt-2 text-muted">
          {result.error === 410
            ? 'This link has expired. Please ask your advisor for a new one.'
            : 'This link is not valid. Please ask your advisor for a new one.'}
        </p>
      </div>
    );
  }
  const p = result.proposal;
  const byDay = new Map<string, Proposal['items']>();
  for (const it of p.items) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);
  const checkout = p.status === 'approved' ? await loadCheckout(token) : null;
  const people = p.travelers.adults + p.travelers.childrenAges.length;

  return (
    <article className="flex flex-col gap-4">
      <header className="rounded-[28px] bg-surface p-6 sm:p-8">
        <p className="text-sm text-muted">
          Prepared for {p.clientFirstName} by {p.advisorName}
        </p>
        <h1 className="mt-1 text-4xl font-normal tracking-tight">{p.title}</h1>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-[20px] bg-canvas p-2.5">
            <Tile icon={CalendarDays} />
            <div>
              <p className="text-xs text-muted">Dates</p>
              <p>
                {short(p.startDate)} – {short(p.endDate)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-[20px] bg-canvas p-2.5">
            <Tile icon={UsersRound} />
            <div>
              <p className="text-xs text-muted">Travelers</p>
              <p>
                {people} {people === 1 ? 'person' : 'people'}
              </p>
            </div>
          </div>
          <div className="col-span-2 rounded-[20px] bg-accent-strong p-4 text-white sm:col-span-1">
            <p className="text-xs">Total</p>
            <p className="text-3xl font-light">{money(p.totals.total)}</p>
          </div>
        </div>
      </header>

      {[...byDay.entries()].map(([day, items]) => (
        <section
          key={day}
          aria-label={longDate(day)}
          className="rounded-[28px] bg-surface p-5 sm:p-6"
        >
          <h2 className="mb-3 text-sm text-muted">{longDate(day)}</h2>
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.id} className="rounded-[22px] bg-canvas p-2.5 pr-4">
                {it.hotel ? (
                  <div className="flex gap-3">
                    <Tile icon={BedDouble} />
                    <div className="min-w-0 flex-1">
                      <p className="text-lg">
                        {it.hotel.name}{' '}
                        <span
                          className="text-sm text-muted"
                          aria-label={`${it.hotel.starRating} stars`}
                        >
                          {'★'.repeat(Math.round(it.hotel.starRating))}
                        </span>
                      </p>
                      <p className="text-sm text-muted">{it.hotel.address}</p>
                      <p className="mt-2 text-sm">
                        {it.hotel.roomName} · {BOARD[it.hotel.board] ?? it.hotel.board} ·{' '}
                        {it.hotel.nights} night{it.hotel.nights === 1 ? '' : 's'},{' '}
                        {short(it.hotel.checkIn)} to {short(it.hotel.checkOut)}
                      </p>
                      {it.hotel.perks.length > 0 && (
                        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent-deep">
                          <Gift size={16} strokeWidth={1.5} aria-hidden />{' '}
                          {it.hotel.perks.map((x) => x.description).join(' · ')}
                        </p>
                      )}
                      <p className="mt-2 text-sm">
                        <span className="text-lg">{money(it.hotel.total)}</span>{' '}
                        <span className="text-muted">
                          including {money(it.hotel.taxes)} taxes
                          {it.hotel.feesAtHotel.amountMinor !== '0' && (
                            <>, plus {money(it.hotel.feesAtHotel)} paid at the hotel</>
                          )}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted">{it.hotel.cancellationPolicy}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Tile icon={ICONS[it.kind] ?? StickyNote} />
                    <div className="min-w-0 flex-1">
                      <p>
                        {it.startTime && <span className="mr-2 text-muted">{it.startTime}</span>}
                        {it.title}
                      </p>
                      {it.details && <p className="text-sm text-muted">{it.details}</p>}
                    </div>
                    {it.price && <p>{money(it.price)}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-label="Price" className="rounded-[28px] bg-surface p-6">
        <p className="text-sm text-muted">Total</p>
        <p className="text-4xl font-light">{money(p.totals.total)}</p>
        <p className="mt-2 text-sm text-muted">
          Includes {money(p.totals.taxesIncluded)} taxes
          {p.totals.planningFee.amountMinor !== '0' && (
            <> and a {money(p.totals.planningFee)} planning fee</>
          )}
          .
          {p.totals.payableAtProperty.amountMinor !== '0' && (
            <> {money(p.totals.payableAtProperty)} is paid directly at the hotels.</>
          )}
        </p>
        <p className="mt-3 text-xs text-muted">
          Prices last checked {new Date(p.ratesCheckedAt).toUTCString()}.
        </p>
      </section>

      {checkout && (
        <Checkout
          token={token}
          initial={checkout}
          suggestedName={p.decidedByName}
          advisorName={p.advisorName}
        />
      )}
      <Decision
        token={token}
        status={checkout ? 'booking' : p.status}
        ratesExpired={p.ratesExpired}
        advisorName={p.advisorName}
        decidedByName={p.decidedByName}
      />
    </article>
  );
}
