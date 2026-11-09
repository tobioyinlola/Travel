import { newId } from '../../modules/shared-kernel/index.js';
import { requestContext } from '../context/request-context.js';
import { Database } from '../db/database.js';

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

/**
 * Appends to the audit trail (FR-AUTH-09). Lives in the platform rather than the audit module because every
 * module, including foundation modules in the same layer as audit, must write audit rows synchronously in
 * its own transaction (ADR-11). Reading the trail stays in the audit module.
 *
 * Joins the caller's open transaction, so the row commits or rolls back with the change it describes.
 */
export class AuditWriter {
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
          entry.actorId === undefined ? (requestContext.get()?.actorId ?? null) : entry.actorId,
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
}
