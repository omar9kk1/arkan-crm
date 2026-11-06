import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FollowupsController } from './followups.controller';
import { FollowUpsService } from './followups.service';
import { FollowUpSchedulerService } from './followups-scheduler.service';

/**
 * The employee follow-ups domain: subject materialization, the scoped read
 * paths, the atomic multi-subject save and the background escalation
 * scheduler (notifications reuse the existing NotificationsModule delivery).
 *
 * Requires migration `20261024120000_follow_up_subjects`; until it is applied
 * the API answers an explicit 503 and the scheduler stays idle (never a
 * silent fallback, never a dev-database shortcut).
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FollowupsController],
  providers: [FollowUpsService, FollowUpSchedulerService],
  exports: [FollowUpsService],
})
export class FollowupsModule {}
