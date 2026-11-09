import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { Shell } from '@/components/shell';

const areas = [
  {
    href: '/dashboard',
    title: 'Advisor portal',
    body: 'Clients, itineraries, proposals, bookings and earnings.',
  },
  {
    href: '/admin',
    title: 'Admin console',
    body: 'Application review, finance, payouts and configuration.',
  },
];

export default function Home() {
  return (
    <Shell area="Home">
      <h1 className="text-3xl font-semibold">Advisor Travel Platform</h1>
      <p className="mt-2 text-muted">
        Sprint 0 skeleton. Each area below is a route group in this app.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {areas.map((a) => (
          <li key={a.href} className="rounded-lg border border-gray-200 bg-surface p-5">
            <Link
              href={a.href}
              className="text-lg font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              {a.title}
            </Link>
            <p className="mt-1 text-sm text-muted">{a.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <ApiStatus />
      </div>
    </Shell>
  );
}
