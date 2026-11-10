import { HttpStatus, Injectable } from '@nestjs/common';
import { Database } from './db/database.js';
import { ProblemException, problemType } from './http/problem.js';
import { PLATFORM } from './modules.js';

const CACHE_MS = 5_000;

export interface FlagView {
  key: string;
  enabled: boolean;
  description: string;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Feature flags and kill switches (FR-ADM-04). Flags live in one platform table that admins change at runtime; every
 * process re-reads it every few seconds, so a switch takes effect everywhere within moments and without a deploy.
 * An unknown flag counts as on, so a typo cannot silently disable a feature.
 */
@Injectable()
export class FeatureFlags {
  private cache: { at: number; flags: Map<string, boolean> } | null = null;

  constructor(private readonly db: Database) {}

  private async load(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.flags;
    const rows = await this.db.read<{ key: string; enabled: boolean }>(
      PLATFORM,
      'SELECT key, enabled FROM platform.feature_flags',
    );
    const flags = new Map(rows.map((r) => [r.key, r.enabled]));
    this.cache = { at: Date.now(), flags };
    return flags;
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.load()).get(key) ?? true;
  }

  /** Throws a 503 problem when the flag is off: the standard answer for a paused feature. */
  async require(key: string, slug: string, title: string): Promise<void> {
    if (!(await this.isEnabled(key)))
      throw new ProblemException(
        HttpStatus.SERVICE_UNAVAILABLE,
        problemType(slug),
        title,
        'This is temporarily paused. Please try again later.',
      );
  }

  async list(): Promise<FlagView[]> {
    const rows = await this.db.read<{
      key: string;
      enabled: boolean;
      description: string;
      updated_at: Date;
      updated_by: string | null;
    }>(PLATFORM, 'SELECT * FROM platform.feature_flags ORDER BY key');
    return rows.map((r) => ({
      key: r.key,
      enabled: r.enabled,
      description: r.description,
      updatedAt: r.updated_at.toISOString(),
      updatedBy: r.updated_by,
    }));
  }

  async set(key: string, enabled: boolean, actorId: string): Promise<FlagView> {
    const rows = await this.db.transaction(PLATFORM, (tx) =>
      tx.query(
        `UPDATE platform.feature_flags SET enabled = $2, updated_by = $3, updated_at = now() WHERE key = $1 RETURNING key`,
        [key, enabled, actorId],
      ),
    );
    if (rows.length === 0)
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        problemType('not-found'),
        'No such feature flag',
      );
    this.cache = null;
    return (await this.list()).find((f) => f.key === key)!;
  }

  /** Test hook and "apply now" for this process. */
  clearCache(): void {
    this.cache = null;
  }
}
