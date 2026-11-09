'use client';

import { use, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, call } from '@/lib/api';

/** Test-mode stand-in for the identity-verification provider's hosted page. */
export default function FakeKycPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const [done, setDone] = useState<string | null>(null);
  async function complete(outcome: 'pass' | 'fail') {
    await call(
      api.POST('/v1/dev/fake-kyc/{reference}/{outcome}', {
        params: { path: { reference: ref, outcome } },
      }),
    );
    setDone(outcome);
  }
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card title="Identity verification (test mode)">
        <p className="text-sm text-muted">
          A real provider would scan your ID and a selfie here. Choose the outcome to simulate.
        </p>
        {done ? (
          <div className="mt-4 flex flex-col gap-3">
            <Alert kind="success">
              Result sent ({done}). It reaches your application in a few seconds.
            </Alert>
            <a className="text-brand-700 underline" href="/application">
              Back to your application
            </a>
          </div>
        ) : (
          <div className="mt-4 flex gap-3">
            <Button onClick={() => complete('pass')}>Verification passes</Button>
            <Button variant="danger" onClick={() => complete('fail')}>
              Verification fails
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
