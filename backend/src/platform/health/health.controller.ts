import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Database } from '../db/database.js';
import { Public } from '../http/auth.js';
import { REDIS } from '../tokens.js';

class HealthChecksDto {
  @ApiProperty() database!: boolean;
  @ApiProperty() redis!: boolean;
}

class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty({ type: HealthChecksDto }) checks!: HealthChecksDto;
}

@ApiTags('platform')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const [database, redis] = await Promise.all([
      this.db.ping().catch(() => false),
      this.pingRedis(),
    ]);
    const ok = database && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database, redis } };
  }

  private async pingRedis(): Promise<boolean> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
