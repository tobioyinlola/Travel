import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';

/** Advisor portal (session cookie + MFA, added in Sprint 1). */
export default function AdvisorLayout({ children }: { children: ReactNode }) {
  return <Shell area="Advisor portal">{children}</Shell>;
}
