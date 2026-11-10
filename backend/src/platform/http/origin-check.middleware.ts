import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite cookies: a browser request that changes state must come from an
 * allowed origin. Requests without an Origin header (server-to-server, webhooks, curl) pass.
 */
export function originCheck(allowed: string[]) {
  const set = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header('origin');
    if (
      SAFE_METHODS.has(req.method) ||
      !origin ||
      set.has(origin) ||
      req.path.startsWith('/webhooks/')
    ) {
      next();
      return;
    }
    res.status(403).type('application/problem+json').json({
      type: 'https://errors.atp.dev/origin-not-allowed',
      title: 'Origin not allowed',
      status: 403,
    });
  };
}
