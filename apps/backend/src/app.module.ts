import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { UsersModule } from './users/users.module';
import { EmployeesModule } from './employees/employees.module';
import { ClientsModule } from './clients/clients.module';
import { OwnersModule } from './owners/owners.module';
import { PropertiesModule } from './properties/properties.module';
import { DealsModule } from './deals/deals.module';
import { CommissionsModule } from './commissions/commissions.module';
import { PayrollModule } from './payroll/payroll.module';
import { FinanceModule } from './finance/finance.module';
import { AttendanceModule } from './attendance/attendance.module';
import { FollowupsModule } from './followups/followups.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FilesModule } from './files/files.module';
import { SmartPasteModule } from './smart-paste/smart-paste.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: environmentSchema,
      validationOptions: { abortEarly: false },
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    JobsModule,
    UsersModule,
    EmployeesModule,
    ClientsModule,
    OwnersModule,
    PropertiesModule,
    DealsModule,
    CommissionsModule,
    PayrollModule,
    FinanceModule,
    AttendanceModule,
    FollowupsModule,
    NotificationsModule,
    FilesModule,
    SmartPasteModule,
  ],
})
export class AppModule {}
