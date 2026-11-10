'use client';

import Link from 'next/link';
import { Alert } from './ui';
import { ApiError } from '@/lib/api';

/** Friendly message when a members-only feature is not open to this account yet (API returns 403). */
export function AccessNotice({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Alert kind="info">
        {error.message}{' '}
        <Link className="underline" href="/application">
          See your account
        </Link>
      </Alert>
    );
  }
  return <Alert>Something went wrong loading this page.</Alert>;
}
