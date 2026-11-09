import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AdminController } from './http/admin.controller.js';

/**
 * Admin module (top layer). Back office: application review, finance tools, config (FR-ADM).
 * Owns schema: admin. May call: shared-kernel and every lower module through its public interface.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminController],
})
export class AdminModule {}
