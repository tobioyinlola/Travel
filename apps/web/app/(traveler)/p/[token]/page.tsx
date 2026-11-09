import type { Metadata } from 'next';

// Proposal links carry a secret token: never index them, never cache them publicly.
export const metadata: Metadata = {
  title: 'Your trip proposal',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{20,200}$/.test(token);
  return (
    <>
      <h1 className="text-2xl font-semibold">Your trip proposal</h1>
      <p className="mt-2 text-muted">
        {valid
          ? 'Proposal view, approval and payment arrive in Sprints 3-5 (FR-ITN-04, FR-TRV-01..03).'
          : 'This link is not valid. Please ask your advisor for a new one.'}
      </p>
    </>
  );
}
