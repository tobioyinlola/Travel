import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { isKnownModuleOrPlatform, moduleRole } from '../modules.js';
import { TxHooks, Tx } from './tx.js';

interface ActiveTx {
  client: PoolClient;
  module: string;
  depth: number;
}

/**
 * One Postgres pool for the whole monolith. The login role (atp_app) has no table privileges of its own:
 * every unit of work runs `SET LOCAL ROLE atp_mod_<module>`, so a module can only touch its own schema
 * (ARCH "Data architecture": database roles enforce ownership).
 *
 * Calling `transaction()` while another one is open (a public-interface call into a lower module) joins the
 * same database transaction (ARCH: "Same transaction as the caller") inside a savepoint, switching to the
 * callee's role and back.
 */
export class Database {
  private readonly als = new AsyncLocalStorage<ActiveTx>();
  private hooks: TxHooks | undefined;

  constructor(readonly pool: Pool) {}

  static fromUrl(connectionString: string, max = 20): Database {
    const pool = new Pool({ connectionString, max, application_name: 'atp' });
    // An idle client losing its connection must not crash the process; the pool replaces it.
    pool.on('error', (err) => console.error('pg pool error', err.message));
    pool.on('connect', (client) => {
      client.on('error', (err) => console.error('pg client error', err.message));
    });
    return new Database(pool);
  }

  /** Wired by the platform so `tx.publish()` / `tx.enqueue()` can be offered without a cyclic import. */
  setHooks(hooks: TxHooks): void {
    this.hooks = hooks;
  }

  async transaction<T>(module: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!isKnownModuleOrPlatform(module)) throw new Error(`Unknown module: ${module}`);
    const role = moduleRole(module);
    const active = this.als.getStore();

    if (active) {
      const sp = `sp_${active.depth + 1}`;
      await active.client.query(`SAVEPOINT ${sp}`);
      await active.client.query(`SET LOCAL ROLE ${role}`);
      const nested: ActiveTx = { client: active.client, module, depth: active.depth + 1 };
      try {
        const result = await this.als.run(nested, () =>
          fn(new Tx(active.client, module, this.hooks)),
        );
        await active.client.query(`SET LOCAL ROLE ${moduleRole(active.module)}`);
        await active.client.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (e) {
        // Rolling back to the savepoint also undoes the SET LOCAL ROLE issued after it.
        await active.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw e;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await this.als.run({ client, module, depth: 0 }, () =>
        fn(new Tx(client, module, this.hooks)),
      );
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Is the caller currently inside a transaction? (Used to forbid external calls inside transactions.) */
  inTransaction(): boolean {
    return this.als.getStore() !== undefined;
  }

  /** Read-only query outside a unit of work, still under a module role. */
  async read<R extends QueryResultRow>(
    module: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    return this.transaction(module, (tx) => tx.query<R>(sql, params));
  }

  async ping(): Promise<boolean> {
    const r = await this.pool.query('select 1 as ok');
    return r.rows[0]?.ok === 1;
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
