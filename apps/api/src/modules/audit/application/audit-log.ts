import { Injectable } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { requestContext } from '../../../platform/context/request-context.js';
import { Database } from '../../../platform/db/database.js';

export interface AuditEntry {
  actorType: 'user' | 'system' | 'support' | 'provider';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Module recording the change. */
  module: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditRecord extends Required<Omit<AuditEntry, 'metadata'>> {
  id: string;
  occurredAt: Date;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Public interface of the audit module. `record()` joins the caller's open transaction when there is one,
 * so the audit row commits or rolls back with the change it describes.
 */
@Injectable()
export class AuditLog {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<string> {
    const id = newId();
    await this.db.transaction('audit', (tx) =>
      tx.query(
        `INSERT INTO audit.log (id, actor_id, actor_type, action, entity_type, entity_id, module,
                                before, after, correlation_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          entry.actorId ?? requestContext.get()?.actorId ?? null,
          entry.actorType,
          entry.action,
          entry.entityType,
          entry.entityId,
          entry.module,
          entry.before === undefined ? null : JSON.stringify(entry.before),
          entry.after === undefined ? null : JSON.stringify(entry.after),
          requestContext.correlationId(),
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
      ),
    );
    return id;
  }

  async forEntity(entityType: string, entityId: string, limit = 100): Promise<AuditRecord[]> {
    const rows = await this.db.read<Record<string, unknown>>(
      'audit',
      `SELECT id, occurred_at, actor_id, actor_type, action, entity_type, entity_id, module,
              before, after, correlation_id, metadata
         FROM audit.log WHERE entity_type = $1 AND entity_id = $2
        ORDER BY occurred_at DESC LIMIT $3`,
      [entityType, entityId, limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      occurredAt: r.occurred_at as Date,
      actorId: (r.actor_id as string | null) ?? null,
      actorType: r.actor_type as AuditEntry['actorType'],
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      module: r.module as string,
      before: r.before,
      after: r.after,
      correlationId: (r.correlation_id as string | null) ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    }));
  }
}
