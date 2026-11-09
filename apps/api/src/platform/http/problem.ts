import { HttpException, HttpStatus } from '@nestjs/common';

/** RFC 9457 problem details body (ARCH API conventions: "errors use a standard problem-details format"). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string | null;
  errors?: Array<{ path: string; message: string }>;
  [extension: string]: unknown;
}

/** Throw from anywhere to return a typed problem response. */
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly problemType: string,
    title: string,
    detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super({ title, detail }, status);
  }
}

export const problemType = (slug: string) => `https://errors.atp.dev/${slug}`;
