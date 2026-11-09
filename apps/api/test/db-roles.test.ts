import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePlatform, type TestPlatform } from './helpers.js';

/** ARCH "Data architecture": each module's role can write only its own schema. */
describe('module database roles', () => {
  let p: TestPlatform;

  beforeAll(async () => {
    p = makePlatform();
    // A table owned by the booking module, created the way a booking migration would.
    await p.admin.query(`
      SET ROLE atp_mod_booking;
      CREATE TABLE IF NOT EXISTS booking.role_probe (id int PRIMARY KEY);
      RESET ROLE;`);
  });

  afterAll(async () => {
    await p.admin.query('DROP TABLE IF EXISTS booking.role_probe');
    await p.close();
  });

  it('lets a module write its own schema', async () => {
    await p.db.transaction('booking', async (tx) => {
      await tx.query('INSERT INTO booking.role_probe VALUES (1) ON CONFLICT DO NOTHING');
      const rows = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM booking.role_probe',
      );
      expect(rows[0]?.n).toBe(1);
    });
  });

  it('blocks a module from reading or writing another module schema', async () => {
    await expect(
      p.db.transaction('identity', (tx) => tx.query('SELECT * FROM booking.role_probe')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      p.db.transaction('clients', (tx) => tx.query('INSERT INTO booking.role_probe VALUES (2)')),
    ).rejects.toThrow(/permission denied/);
  });

  it('blocks a module from creating objects in another schema', async () => {
    await expect(
      p.db.transaction('catalog', (tx) => tx.query('CREATE TABLE booking.sneaky (id int)')),
    ).rejects.toThrow(/permission denied/);
  });

  it('gives the login role no table access without a module role', async () => {
    await expect(p.db.pool.query('SELECT * FROM booking.role_probe')).rejects.toThrow(
      /permission denied/,
    );
    await expect(p.db.pool.query('SELECT * FROM platform.outbox')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('switches role for a nested call into a lower module and back', async () => {
    await p.db.transaction('booking', async (outer) => {
      const inner = await p.db.transaction('catalog', (tx) =>
        tx.query<{ r: string }>('SELECT current_user AS r'),
      );
      expect(inner[0]?.r).toBe('atp_mod_catalog');
      const after = await outer.query<{ r: string }>('SELECT current_user AS r');
      expect(after[0]?.r).toBe('atp_mod_booking');
    });
  });

  it('rolls back only the nested part when a nested call fails', async () => {
    await p.db.transaction('booking', async (outer) => {
      await outer.query('INSERT INTO booking.role_probe VALUES (10) ON CONFLICT DO NOTHING');
      await expect(
        p.db.transaction('catalog', (tx) => tx.query('SELECT * FROM booking.role_probe')),
      ).rejects.toThrow(/permission denied/);
      const r = await outer.query<{ r: string }>('SELECT current_user AS r');
      expect(r[0]?.r).toBe('atp_mod_booking');
    });
    const rows = await p.admin.query('SELECT 1 FROM booking.role_probe WHERE id = 10');
    expect(rows.rowCount).toBe(1);
  });

  it('rejects unknown module names', async () => {
    await expect(p.db.transaction('nope', async () => 1)).rejects.toThrow(/Unknown module/);
  });
});
