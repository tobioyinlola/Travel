import { createApiClient, type ProblemDetails } from '@atp/api-client';
import { demoFetch } from './demo/fetch';
import { isDemo } from './demo/mode';

/** Browser and server both talk to the same versioned REST API. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export const api = createApiClient(API_BASE_URL, isDemo ? { fetch: demoFetch } : {});

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

function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** "150" or "150.5" in major units -> minor-unit string, exactly (no floating point). */
export function toMinor(major: string, currency: string): string {
  const digits = minorDigits(currency);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(major.trim());
  if (!m) throw new Error('Enter a number like 150 or 150.50');
  const frac = (m[2] ?? '').slice(0, digits).padEnd(digits, '0');
  return String(BigInt(m[1]! + frac));
}

export function toMajor(amountMinor: string, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return amountMinor;
  const s = amountMinor.padStart(digits + 1, '0');
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

export interface UploadedFile {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** Sends one file as raw bytes (the API takes PDF, PNG and JPEG up to 5 MB and checks the content itself). */
export async function uploadFile(path: string, file: File): Promise<UploadedFile> {
  if (isDemo)
    return {
      id: crypto.randomUUID(),
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    };
  const res = await fetch(`${API_BASE_URL}${path}?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as Partial<ProblemDetails>;
    throw new ApiError({
      type: problem.type ?? 'about:blank',
      title: problem.title ?? res.statusText,
      status: res.status,
      ...(problem.detail ? { detail: problem.detail } : {}),
    });
  }
  return (await res.json()) as UploadedFile;
}

export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1_048_576
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1_048_576).toFixed(1)} MB`;
