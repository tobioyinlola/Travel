// Public interface of the notifications module. Other modules may import ONLY from this file.
// Other modules trigger messages by publishing events; there is nothing to call directly.
export { NotificationsModule } from './notifications.module.js';
export {
  MESSAGING_PORT,
  type MessagingPort,
  type OutboundMessage,
} from './application/messaging.port.js';
export { MemoryMessaging } from './infrastructure/transports.js';
