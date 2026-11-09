import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin' };

export default function AdminPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Admin console</h1>
      <p className="mt-2 text-muted">Application review arrives in Sprint 1 (FR-ADM-01).</p>
    </>
  );
}
