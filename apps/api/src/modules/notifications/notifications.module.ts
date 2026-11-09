import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../../config.js';
import { MESSAGING_PORT } from './application/messaging.port.js';
import { NotificationsService } from './application/notifications.service.js';
import { LogMessaging, MemoryMessaging, SmtpMessaging } from './infrastructure/transports.js';

/**
 * Notifications module (foundation layer). Transactional email now; SMS/push/in-app later (FR-NTF).
 * Owns schema: notifications. Reacts to events only; never calls other modules.
 */
@Module({})
export class NotificationsModule {
  static forRoot(config: AppConfig): DynamicModule {
    const memory = new MemoryMessaging();
    return {
      module: NotificationsModule,
      providers: [
        NotificationsService,
        {
          provide: MESSAGING_PORT,
          useFactory: () =>
            config.MAIL_TRANSPORT === 'memory'
              ? memory
              : config.MAIL_TRANSPORT === 'log'
                ? new LogMessaging()
                : new SmtpMessaging(config.SMTP_URL, config.MAIL_FROM, memory),
        },
      ],
      exports: [MESSAGING_PORT],
    };
  }
}
