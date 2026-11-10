import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <h2>Who this covers</h2>
      <p>
        Travel advisors who sign up, and the travelers and clients whose trips advisors plan on the
        platform.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          Advisors: name, email, business details, identity verification result, payout details.
        </li>
        <li>
          Clients and travelers: name, email, trip dates, preferences and notes your advisor adds.
        </li>
        <li>Messages you send through a proposal link, and the decisions you make on it.</li>
        <li>Booking and payment records. Card details go to the payment provider, never to us.</li>
      </ul>
      <h2>Why</h2>
      <p>
        To plan and book trips, pay advisors their commission, keep the service secure and meet
        legal duties. Client notes are visible only to the advisor who wrote them.
      </p>
      <h2>Who sees it</h2>
      <p>
        The advisor you work with; staff who need it for support, finance or security, with every
        access recorded; and providers that run parts of the service (hotels, payments, email,
        identity checks). We do not sell personal data.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data or for it to be erased. We verify who you are, then
        respond within 30 days. Some financial records must be kept by law and are kept without
        personal details where we can.
      </p>
      <h2>Retention and security</h2>
      <p>
        Sensitive fields are encrypted, sign-in for advisors and staff requires a second factor, and
        proposal links are private and expire.
      </p>
      <h2>Contact</h2>
      <p>The privacy contact address will be published here before launch.</p>
    </>
  );
}
