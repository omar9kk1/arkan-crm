import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

/**
 * Manager-only employee directory.
 *
 * The global `JwtAuthGuard` + `RolesGuard` already require a valid session, and
 * the class-level `@Roles(Role.MANAGER)` rule denies every employee — including
 * an attempt to rename another employee — before a handler runs. No recipient or
 * manager identity is ever read from the request body.
 */
@Controller('employees')
@Roles(Role.MANAGER)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list() {
    return this.employees.list();
  }

  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(id, dto);
  }
}
