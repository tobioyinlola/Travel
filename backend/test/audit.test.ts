import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/index.js';
import { AuditWriter } from '../src/platform/audit/audit-writer.js';
import { newId } from '../src/modules/shared-kernel/index.js';
import { makePlatform, type TestPlatform } from './helpers.js';

describe('audit log (FR-AUTH-09, NFR-12)', () => {
  let p: TestPlatform;
  let audit: AuditWriter;
  let reader: AuditLog;

  beforeAll(() => {
    p = makePlatform();
    audit = new AuditWriter(p.db);
    reader = new AuditLog(p.db);
  });
  afterAll(() => p.close());

  it('records an entry and reads it back', async () => {
    const entityId = newId();
    await audit.record({
      actorType: 'user',
      actorId: newId(),
      action: 'advisor.status_changed',
      entityType: 'advisor',
      entityId,
      module: 'identity',
      before: { status: 'Applied' },
      after: { status: 'Under review' },
    });
    const rows = await reader.forEntity('advisor', entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'advisor.status_changed',
      before: { status: 'Applied' },
    });
  });

  it('commits or rolls back with the caller transaction', async () => {
    const entityId = newId();
    await expect(
      p.db.transaction('identity', async () => {
        await audit.record({
          actorType: 'system',
          action: 'x',
          entityType: 'advisor',
          entityId,
          module: 'identity',
        });
        throw new Error('business change failed');
      }),
    ).rejects.toThrow();
    expect(await reader.forEntity('advisor', entityId)).toHaveLength(0);
  });

  it('cannot be updated or deleted, even by the owning role', async () => {
    const entityId = newId();
    await audit.record({
      actorType: 'system',
      action: 'x',
      entityType: 'advisor',
      entityId,
      module: 'identity',
    });
    await expect(
      p.db.transaction('audit', (tx) =>
        tx.query(`UPDATE audit.log SET action = 'y' WHERE entity_id = $1`, [entityId]),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      p.db.transaction('audit', (tx) =>
        tx.query('DELETE FROM audit.log WHERE entity_id = $1', [entityId]),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('lets other modules append but not read', async () => {
    await expect(
      p.db.transaction('booking', (tx) => tx.query('SELECT * FROM audit.log')),
    ).rejects.toThrow(/permission denied/);
  });
});
