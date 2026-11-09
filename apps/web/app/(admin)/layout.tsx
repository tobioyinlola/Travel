import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';

/** Admin, finance and supplier consoles (role-scoped, MFA required). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Shell area="Admin console">{children}</Shell>;
}
