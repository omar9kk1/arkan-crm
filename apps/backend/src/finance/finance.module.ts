import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FxRateService } from './fx-rate.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService, FxRateService],
})
export class FinanceModule {}
