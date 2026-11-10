import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../context/request-context.js';

const HEADER = 'x-correlation-id';
const SAFE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Accepts an incoming correlation id (or generates one), echoes it, and binds it for the request. */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER) ?? req.header('x-request-id');
  const correlationId =
    incoming && SAFE.test(incoming) ? incoming : requestContext.newCorrelationId();
  res.setHeader(HEADER, correlationId);
  (req as Request & { id?: string }).id = correlationId;
  requestContext.run({ correlationId }, () => next());
}
