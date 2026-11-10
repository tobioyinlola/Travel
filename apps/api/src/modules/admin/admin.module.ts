import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AdvisorLifecycleService } from './application/advisor-lifecycle.service.js';
import { AdvisorsAdminController } from './http/advisors.controller.js';
import { DeadLettersController } from './http/dead-letters.controller.js';
import { ConfigAdminController } from './http/config.controller.js';
import { AdminController } from './http/admin.controller.js';

/**
 * Admin module (top layer). Back office: application review, finance tools, config (FR-ADM).
 * Owns schema: admin. May call: shared-kernel and every lower module through its public interface.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    AdminController,
    AdvisorsAdminController,
    ConfigAdminController,
    DeadLettersController,
  ],
  providers: [AdvisorLifecycleService],
})
export class AdminModule {}
