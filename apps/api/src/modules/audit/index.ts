// Public interface of the audit module. Other modules may import ONLY from this file.
// To WRITE audit rows, inject the platform AuditWriter (ADR-11).
export { AuditModule } from './audit.module.js';
export { AuditLog, type AuditRecord } from './application/audit-log.js';
