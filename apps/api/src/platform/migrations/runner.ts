import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from 'graphile-worker';
import { Client } from 'pg';
import { MODULES, moduleRole } from '../modules.js';
import { bootstrapSql, graphileWorkerGrantsSql } from './bootstrap.js';

export interface MigrateOptions {
  adminUrl: string;
  appUrl: string;
  /** Directory containing `<module>/migrations/*.sql`. Defaults to the compiled modules directory. */
  modulesDir?: string;
  log?: (msg: string) => void;
}

/**
 * Migration order:
 *   1. platform bootstrap (roles, schemas, platform tables)  - as superuser, idempotent
 *   2. graphile-worker's own migrations + grants
 *   3. each module's SQL files, in registry order, run AS that module's role, so a migration
 *      physically cannot create or alter objects in another module's schema.
 * Applied files are recorded with a checksum; editing an applied file fails the run.
 */
export async function migrate(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const app = new URL(opts.appUrl);
  const appUser = decodeURIComponent(app.username);
  const appPassword = decodeURIComponent(app.password);
  const modulesDir = opts.modulesDir ?? join(import.meta.dirname, '..', '..', 'modules');

  const client = new Client({ connectionString: opts.adminUrl });
  await client.connect();
  try {
    // Serialise concurrent deploys.
    await client.query("SELECT pg_advisory_lock(hashtext('atp_migrations'))");
    await client.query(bootstrapSql(appUser, appPassword));
    log('platform bootstrap: ok');

    await runMigrations({ connectionString: opts.adminUrl });
    await client.query(graphileWorkerGrantsSql(appUser));
    log('graphile-worker: ok');

    for (const mod of MODULES) {
      const dir = join(modulesDir, mod.name, 'migrations');
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sql = readFileSync(join(dir, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const applied = await client.query<{ checksum: string }>(
          'SELECT checksum FROM platform.schema_migrations WHERE module = $1 AND name = $2',
          [mod.name, file],
        );
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== checksum) {
            throw new Error(`Migration ${mod.name}/${file} was edited after being applied`);
          }
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL ROLE ${moduleRole(mod.name)}`);
          await client.query(sql);
          await client.query('RESET ROLE');
          await client.query(
            'INSERT INTO platform.schema_migrations (module, name, checksum) VALUES ($1, $2, $3)',
            [mod.name, file, checksum],
          );
          await client.query('COMMIT');
          log(`${mod.name}/${file}: applied`);
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${mod.name}/${file} failed: ${(e as Error).message}`, {
            cause: e,
          });
        }
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('atp_migrations'))")
      .catch(() => undefined);
    await client.end();
  }
}
