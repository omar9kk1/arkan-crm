import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { ManagersController } from './managers.controller';
import { EmployeesService } from './employees.service';
import { OwnerPromotionService } from './owner-promotion.service';

// OWNER account management + MANAGER read-only team directory.
@Module({
  controllers: [EmployeesController, ManagersController],
  providers: [EmployeesService, OwnerPromotionService],
  exports: [EmployeesService, OwnerPromotionService],
})
export class EmployeesModule {}
