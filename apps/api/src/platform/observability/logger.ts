import pino, { type Logger, type LoggerOptions } from 'pino';
import { requestContext } from '../context/request-context.js';

/** PII and secrets never reach logs (ARCH observability: "structured JSON, PII redacted"). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.otp',
  '*.token',
  '*.secret',
  '*.email',
  '*.phone',
  '*.taxId',
  '*.cardNumber',
  '*.iban',
  '*.accountNumber',
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'atp-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: () => {
      const correlationId = requestContext.correlationId();
      return correlationId ? { correlationId } : {};
    },
  };
}

export function createLogger(level: string): Logger {
  return pino(loggerOptions(level));
}
