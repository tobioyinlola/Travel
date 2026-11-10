import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthFrame } from '@/components/shell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthFrame>
      {children}
      <p className="mt-8 text-xs text-muted">
        By continuing you agree to the{' '}
        <Link className="underline" href="/terms">
          terms
        </Link>{' '}
        and{' '}
        <Link className="underline" href="/privacy">
          privacy policy
        </Link>
        .
      </p>
    </AuthFrame>
  );
}
