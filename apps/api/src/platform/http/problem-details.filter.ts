import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { IllegalTransitionError, MoneyError } from '../../modules/shared-kernel/index.js';
import { requestContext } from '../context/request-context.js';
import { ProblemDetails, ProblemException, problemType } from './problem.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;
    problem.correlationId = requestContext.correlationId();
    if (problem.status >= 500) this.logger.error(exception);
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(e: unknown): ProblemDetails {
    if (e instanceof ProblemException) {
      const body = e.getResponse() as { title: string; detail?: string };
      return {
        type: e.problemType,
        title: body.title,
        status: e.getStatus(),
        detail: body.detail,
        ...e.extensions,
      };
    }
    if (e instanceof ZodError) {
      return {
        type: problemType('validation'),
        title: 'Request validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (e instanceof IllegalTransitionError) {
      return {
        type: problemType('illegal-transition'),
        title: 'Illegal state transition',
        status: 409,
        detail: e.message,
      };
    }
    if (e instanceof MoneyError) {
      return {
        type: problemType('money'),
        title: 'Invalid money value',
        status: 400,
        detail: e.message,
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const response = e.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: unknown }).message)
            ? (response as { message: string[] }).message.join('; ')
            : String((response as { message?: unknown }).message ?? e.message);
      return { type: 'about:blank', title: statusTitle(status), status, detail };
    }
    return { type: 'about:blank', title: 'Internal Server Error', status: 500 };
  }
}

function statusTitle(status: number): string {
  const name = HttpStatus[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
