import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of service' };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <h2>The service</h2>
      <p>
        The platform lets independent travel advisors research, propose and book hotels for their
        clients and earn commission on completed stays.
      </p>
      <h2>Advisors</h2>
      <ul>
        <li>You are an independent contractor, not an employee.</li>
        <li>You pay the membership fee shown at sign-up unless a waiver applies.</li>
        <li>
          Commission is earned on stays that complete and is reversed if a booking is cancelled or
          refunded.
        </li>
        <li>Payouts require verified identity and payout details, and can be held for review.</li>
        <li>We may suspend an account that breaks these terms or puts travelers at risk.</li>
      </ul>
      <h2>Travelers</h2>
      <p>
        Prices on a proposal are valid until the time shown. Cancellation terms are those of each
        hotel rate and are shown before you book.
      </p>
      <h2>Liability</h2>
      <p>The liability and governing-law terms will be completed by counsel before launch.</p>
    </>
  );
}
