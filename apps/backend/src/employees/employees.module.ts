import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

// The real employee directory: a manager-only HTTP surface over EMPLOYEE-role
// `User` accounts, their persisted `EmployeeProfile`, and their property
// statistics linked through `Property.createdByUserId`.
@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
