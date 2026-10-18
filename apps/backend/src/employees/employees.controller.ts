import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Role } from '@arkan/shared';
import type { AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { SetEmployeeActivationDto } from './dto/set-employee-activation.dto';

/**
 * Manager-only employee directory.
 *
 * The global `JwtAuthGuard` + `RolesGuard` already require a valid session, and
 * the class-level `@Roles(Role.MANAGER)` rule denies every employee — including
 * an attempt to rename or deactivate a colleague — before a handler runs. The
 * acting manager for the audit trail is read from the VERIFIED session
 * (`request.user`), never from the request body.
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
  create(@Req() request: { user: AuthUser }, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(request.user, dto);
  }

  @Patch(':id/activation')
  setActivation(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEmployeeActivationDto,
  ) {
    return this.employees.setActivation(request.user, id, dto.isActive);
  }

  @Patch(':id')
  update(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(request.user, id, dto);
  }
}
