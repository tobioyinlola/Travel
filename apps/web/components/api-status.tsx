'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Small live check that the typed client reaches the API. */
export function ApiStatus() {
  const { data, isError, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/health');
      if (error) throw new Error('API unavailable');
      return data;
    },
  });
  const label = isPending ? 'Checking API…' : isError ? 'API unreachable' : `API ${data?.status}`;
  return (
    <p role="status" className="text-sm text-muted">
      {label}
    </p>
  );
}
