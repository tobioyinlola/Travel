import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { Shell } from '@/components/shell';

export default function Home() {
  return (
    <Shell area="Home">
      <h1 className="text-3xl font-semibold">Run your travel business in one place</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Training, clients, proposals, bookings and commission, with the licences and supplier
        relationships handled for you.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Become an advisor
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-gray-300 bg-surface px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Sign in
        </Link>
      </div>
      <div className="mt-10">
        <ApiStatus />
      </div>
    </Shell>
  );
}
