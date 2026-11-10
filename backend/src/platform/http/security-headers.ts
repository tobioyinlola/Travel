import type { NextFunction, Request, Response } from 'express';

/**
 * Response headers for an API that only ever returns JSON (OWASP secure-headers baseline). Nothing here can break a
 * legitimate client: the API serves no HTML, so the content policy forbids everything.
 */
export function securityHeaders(opts: { production: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Responses carry personal and financial data and per-user results: never store them in shared caches.
    res.setHeader('Cache-Control', 'no-store');
    if (opts.production)
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
