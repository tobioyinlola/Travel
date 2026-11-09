import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Observable, from, lastValueFrom } from 'rxjs';
import { Database } from '../db/database.js';
import { PLATFORM } from '../modules.js';
import { ProblemException, problemType } from './problem.js';

const REQUIRED = 'atp:idempotency-required';
/** Mark endpoints that move money or create bookings: the Idempotency-Key header becomes mandatory. */
export const RequireIdempotencyKey = () => SetMetadata(REQUIRED, true);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export const IDEMPOTENCY_TTL_HOURS = Symbol('IDEMPOTENCY_TTL_HOURS');

/**
 * Every state-changing request accepts an Idempotency-Key header and replays the stored result on retry
 * (ARCH API conventions). Same key + different body => 422. Same key while the first is running => 409.
 * Failed requests release the key so the client can retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly db: Database,
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_TTL_HOURS) private readonly ttlHours: number,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!MUTATING.has(req.method)) return next.handle();

    const key = req.header('idempotency-key');
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) {
      if (required) {
        throw new ProblemException(
          HttpStatus.BAD_REQUEST,
          problemType('idempotency-key-required'),
          'Idempotency-Key header is required for this operation',
        );
      }
      return next.handle();
    }
    if (!KEY_RE.test(key)) {
      throw new ProblemException(
        HttpStatus.BAD_REQUEST,
        problemType('idempotency-key-invalid'),
        'Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-]',
      );
    }

    const scope = `${req.user?.id ?? 'anonymous'}:${req.method}:${req.route?.path ?? req.path}`;
    const hash = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    return from(this.handle(scope, key, hash, status, res, next));
  }

  private async handle(
    scope: string,
    key: string,
    hash: string,
    status: number,
    res: Response,
    next: CallHandler,
  ): Promise<unknown> {
    const claimed = await this.db.read<{ key: string }>(
      PLATFORM,
      `INSERT INTO platform.idempotency_keys (scope, key, request_hash, status, expires_at)
       VALUES ($1, $2, $3, 'in_progress', now() + make_interval(hours => $4))
       ON CONFLICT (scope, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, status = 'in_progress',
             response_status = NULL, response_body = NULL,
             created_at = now(), expires_at = EXCLUDED.expires_at
         WHERE platform.idempotency_keys.expires_at < now()
       RETURNING key`,
      [scope, key, hash, this.ttlHours],
    );

    if (claimed.length === 0) {
      const [existing] = await this.db.read<{
        request_hash: string;
        status: string;
        response_status: number | null;
        response_body: unknown;
      }>(
        PLATFORM,
        'SELECT request_hash, status, response_status, response_body FROM platform.idempotency_keys WHERE scope = $1 AND key = $2',
        [scope, key],
      );
      if (!existing) throw new Error('Idempotency key vanished');
      if (existing.request_hash !== hash) {
        throw new ProblemException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          problemType('idempotency-key-reused'),
          'Idempotency-Key was already used with a different request body',
        );
      }
      if (existing.status === 'in_progress') {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          problemType('idempotency-in-progress'),
          'A request with this Idempotency-Key is still being processed',
        );
      }
      // Only successful responses are stored, and a route's success status is fixed, so Nest's own
      // status code for the route matches the original response.
      res.setHeader('Idempotent-Replayed', 'true');
      return existing.response_body;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: null });
      await this.db.read(
        PLATFORM,
        `UPDATE platform.idempotency_keys SET status = 'completed', response_status = $3, response_body = $4
          WHERE scope = $1 AND key = $2`,
        [scope, key, status, JSON.stringify(body ?? null)],
      );
      return body;
    } catch (e) {
      await this.db.read(
        PLATFORM,
        'DELETE FROM platform.idempotency_keys WHERE scope = $1 AND key = $2',
        [scope, key],
      );
      throw e;
    }
  }
}
