import { Injectable } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';
import type { AuditEntry } from '../../../platform/audit/audit-writer.js';

export interface AuditRecord {
  id: string;
  occurredAt: Date;
  actorId: string | null;
  actorType: AuditEntry['actorType'];
  action: string;
  entityType: string;
  entityId: string;
  module: string;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
}

/** Read side of the audit trail (admin console, support). Writing goes through the platform AuditWriter. */
@Injectable()
export class AuditLog {
  constructor(private readonly db: Database) {}

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
