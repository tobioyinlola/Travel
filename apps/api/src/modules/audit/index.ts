// Public interface of the audit module. Other modules may import ONLY from this file.
export { AuditModule } from './audit.module.js';
export { AuditLog, type AuditEntry, type AuditRecord } from './application/audit-log.js';
