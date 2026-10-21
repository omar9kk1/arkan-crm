import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushDispatcherService } from './push-dispatcher.service';

/**
 * Web Push for managers: the per-device subscription API plus the dispatcher
 * that delivers the EXISTING in-app notifications to the browsers that asked
 * for them. No event producer lives here — the `Notification` rows are the
 * single source of truth.
 */
@Module({
  controllers: [PushController],
  providers: [PushService, PushDispatcherService],
  exports: [PushService],
})
export class PushModule {}
