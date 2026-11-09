import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };

/** RFC 9457 problem details returned by every API error. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string | null;
  errors?: Array<{ path: string; message: string }>;
}

/**
 * Typed client generated from the API's OpenAPI contract. Regenerate with `pnpm api-client:generate`
 * after changing controllers. Sends cookies so the advisor session works from the browser.
 */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, 'baseUrl'> = {}) {
  return createClient<paths>({ baseUrl, credentials: 'include', ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** A fresh Idempotency-Key for state-changing requests (retry the same request with the same key). */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
