'use client';

import { useRouter } from 'next/navigation';
import { ClientForm } from '@/components/client-form';
import { Card } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function NewClientPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <Card title="Add client">
        <ClientForm
          submitLabel="Save client"
          onSubmit={async (v) => {
            const c = await call(api.POST('/v1/clients', { body: v }));
            router.push(`/clients/${c.id}`);
          }}
        />
      </Card>
    </div>
  );
}
