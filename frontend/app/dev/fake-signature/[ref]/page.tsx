'use client';

import { use, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, call } from '@/lib/api';

/** Test-mode stand-in for the e-signature provider's signing page. */
export default function FakeSignaturePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const [done, setDone] = useState<string | null>(null);
  async function complete(outcome: 'sign' | 'decline') {
    await call(
      api.POST('/v1/dev/fake-signature/{envelopeRef}/{outcome}', {
        params: { path: { envelopeRef: ref, outcome } },
      }),
    );
    setDone(outcome);
  }
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card title="Independent contractor agreement (test mode)">
        <p className="text-sm text-muted">
          A real provider would show the full agreement for review and signature.
        </p>
        {done ? (
          <div className="mt-4 flex flex-col gap-3">
            <Alert kind="success">
              {done === 'sign' ? 'Signed.' : 'Declined.'} This reaches your application in a few
              seconds.
            </Alert>
            <a className="text-brand-700 underline" href="/application">
              Back to your application
            </a>
          </div>
        ) : (
          <div className="mt-4 flex gap-3">
            <Button onClick={() => complete('sign')}>Sign agreement</Button>
            <Button variant="secondary" onClick={() => complete('decline')}>
              Decline
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
