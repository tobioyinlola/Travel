import { BadgePercent, GraduationCap, Luggage, UserRound } from 'lucide-react';
import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { Logo } from '@/components/shell';

const POINTS = [
  {
    icon: GraduationCap,
    title: 'Training included',
    body: 'Pass the Essentials course and start booking real trips.',
  },
  {
    icon: UserRound,
    title: 'Clients in one place',
    body: 'Preferences, companions and trip history for every client.',
  },
  {
    icon: Luggage,
    title: 'Proposals clients approve',
    body: 'Live hotel rates, partner perks and a link your client opens on any phone.',
  },
  {
    icon: BadgePercent,
    title: 'Commission handled',
    body: 'Tracked from booking to payout, visible at every step.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
        <Link
          href="/login"
          className="inline-flex h-12 items-center rounded-full bg-surface px-6 text-[15px] font-medium hover:bg-white/70"
        >
          Sign in
        </Link>
      </header>
      <main id="main" className="mx-auto grid max-w-6xl gap-6 py-12 lg:grid-cols-[1.1fr_1fr]">
        <section className="flex flex-col justify-between rounded-[28px] bg-surface p-8 sm:p-10">
          <div>
            <p className="inline-flex rounded-full bg-canvas px-4 py-2 text-sm text-muted">
              For independent travel advisors
            </p>
            <h1 className="mt-6 text-4xl font-normal leading-tight tracking-tight sm:text-5xl">
              Run your travel business from one connected workspace
            </h1>
            <p className="mt-4 max-w-lg text-lg text-muted">
              Licences, supplier relationships, payments and commission are handled for you. You
              bring the relationships and the taste.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center rounded-full bg-accent-strong px-6 text-[15px] font-medium text-white hover:bg-accent-deep"
            >
              Become an advisor
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-full bg-canvas px-6 text-[15px] font-medium hover:bg-line"
            >
              Sign in
            </Link>
          </div>
        </section>
        <section className="flex flex-col gap-3 rounded-[28px] bg-accent p-6 sm:p-8">
          <p className="mb-2 text-2xl font-light text-white">
            Everything about a trip, linked together
          </p>
          {POINTS.map((p) => (
            <div
              key={p.title}
              className="flex items-center gap-4 rounded-[20px] bg-surface p-2.5 pr-4"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-canvas">
                <p.icon size={20} strokeWidth={1.5} aria-hidden />
              </span>
              <span>
                <span className="block">{p.title}</span>
                <span className="block text-sm text-muted">{p.body}</span>
              </span>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl">
        <ApiStatus />
      </footer>
    </div>
  );
}
