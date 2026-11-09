import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './config.js';
import { AdminModule } from './modules/admin/index.js';
import { AiModule } from './modules/ai/index.js';
import { AuditModule } from './modules/audit/index.js';
import { BookingModule } from './modules/booking/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { ClientsModule } from './modules/clients/index.js';
import { CommissionPaymentsModule } from './modules/commission-payments/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { ItinerariesModule } from './modules/itineraries/index.js';
import { LearningModule } from './modules/learning/index.js';
import { MembershipModule } from './modules/membership/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { PartnersModule } from './modules/partners/index.js';
import { ReportingModule } from './modules/reporting/index.js';
import { PlatformModule, type ProcessRole } from './platform/platform.module.js';

/** Every business module, in layer order (foundation -> top). Both processes load all of them. */
export const BUSINESS_MODULES = [
  IdentityModule,
  NotificationsModule,
  AuditModule,
  ClientsModule,
  CatalogModule,
  PartnersModule,
  MembershipModule,
  LearningModule,
  ItinerariesModule,
  BookingModule,
  CommissionPaymentsModule,
  ReportingModule,
  AiModule,
  AdminModule,
];

@Module({})
export class AppModule {
  static forRole(config: AppConfig, role: ProcessRole): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config, role), ...BUSINESS_MODULES],
    };
  }
}
