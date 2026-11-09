import { Module } from '@nestjs/common';

/**
 * Notifications module (foundation layer). Transactional email now; SMS/push/in-app later (FR-NTF).
 * Owns schema(s): notifications.
 * May call (public interfaces only): shared-kernel.
 */
@Module({
  providers: [],
  exports: [],
})
export class NotificationsModule {}
