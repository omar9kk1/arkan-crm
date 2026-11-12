import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SystemLogService } from './system-log.service';

// NotificationsController/Service, the per-recipient inbox API and the
// transaction-safe event writers used by the property workflow.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, SystemLogService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
