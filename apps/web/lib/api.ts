import { createApiClient, type ProblemDetails } from '@atp/api-client';

/** Browser and server both talk to the same versioned REST API. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export const api = createApiClient(API_BASE_URL);

/** Thrown for any non-2xx response; carries the API's RFC 9457 problem details. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
  get status(): number {
    return this.problem.status;
  }
  /** First validation message for a field, if any. */
  fieldError(path: string): string | undefined {
    return this.problem.errors?.find((e) => e.path === path)?.message;
  }
}

/** Unwraps an openapi-fetch result: returns data or throws ApiError. */
export async function call<T>(
  p: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) {
    const problem = (error ?? {}) as Partial<ProblemDetails>;
    throw new ApiError({
      type: problem.type ?? 'about:blank',
      title: problem.title ?? response.statusText,
      status: response.status,
      ...(problem.detail ? { detail: problem.detail } : {}),
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
  }
  return data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}

export function formatMoney(m: { amountMinor: string; currency: string }): string {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: m.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const value = Number(m.amountMinor) / 10 ** digits; // display only; never used for arithmetic
  return new Intl.NumberFormat('en', { style: 'currency', currency: m.currency }).format(value);
}
