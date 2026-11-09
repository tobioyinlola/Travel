import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Shell area="Account">
      <div className="mx-auto max-w-md">{children}</div>
    </Shell>
  );
}
