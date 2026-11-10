import { Module } from '@nestjs/common';
import { FactsService } from './application/facts.service.js';
import { ReportsService } from './application/reports.service.js';
import { ReportsController } from './http/reports.controller.js';

/**
 * Reporting module (top layer). Read models built from events and the reports over them (FR-RPT).
 * Owns schema: reporting. Never a source of truth: it can be rebuilt by replaying events.
 */
@Module({
  controllers: [ReportsController],
  providers: [FactsService, ReportsService],
})
export class ReportingModule {}
