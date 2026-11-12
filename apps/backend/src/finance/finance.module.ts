import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
