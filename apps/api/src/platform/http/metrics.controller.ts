import {
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  Inject,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { MetricsRegistry } from '../metrics.js';
import { Public } from './auth.js';
import { ProblemException, problemType } from './problem.js';

/**
 * GET /metrics for the monitoring system. Not part of the public API: a bearer token (METRICS_TOKEN) is required, and
 * with no token configured the endpoint does not exist.
 */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
@Public()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(@Headers('authorization') auth?: string): Promise<string> {
    const token = this.config.METRICS_TOKEN;
    if (!token)
      throw new ProblemException(HttpStatus.NOT_FOUND, problemType('not-found'), 'Not found');
    const given = Buffer.from((auth ?? '').replace(/^Bearer /, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        problemType('unauthenticated'),
        'Invalid metrics token',
      );
    return this.metrics.render();
  }
}
