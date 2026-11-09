import { createApiClient } from '@atp/api-client';

/** Browser and server both talk to the same versioned REST API. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export const api = createApiClient(API_BASE_URL);
