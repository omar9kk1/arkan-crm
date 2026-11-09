import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@arkan/shared';
import type { AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { SetEmployeeActivationDto } from './dto/set-employee-activation.dto';
import { AssignEmployeeManagerDto } from './dto/assign-employee-manager.dto';
import { ListEmployeesQueryDto } from './dto/list-employees.query';
import { ListEmployeePropertiesQueryDto } from './dto/list-employee-properties.query';

/**
 * Account directory and team management.
 *
 * - OWNER: full account management.
 * - MANAGER: read-only view of the employees currently assigned to them.
 * - EMPLOYEE: no access.
 *
 * The global guards verify the session; every mutating method re-derives the
 * actor from `request.user` and enforces OWNER inside the service too.
 */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER)
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListEmployeesQueryDto,
  ) {
    return this.employees.list(request.user, query);
  }

  /** Full employee detail (the drawer); MANAGER is scoped to their team. */
  @Get(':id')
  @Roles(Role.OWNER, Role.MANAGER)
  findOne(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employees.findOne(request.user, id);
  }

  /** Paginated property list for the employee drawer (same scope as detail). */
  @Get(':id/properties')
  @Roles(Role.OWNER, Role.MANAGER)
  properties(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListEmployeePropertiesQueryDto,
  ) {
    return this.employees.listProperties(request.user, id, query);
  }

  @Post()
  @Roles(Role.OWNER)
  create(@Req() request: { user: AuthUser }, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(request.user, dto);
  }

  @Patch(':id/activation')
  @Roles(Role.OWNER)
  setActivation(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEmployeeActivationDto,
  ) {
    return this.employees.setActivation(request.user, id, dto.isActive);
  }

  @Patch(':id/manager')
  @Roles(Role.OWNER)
  assignManager(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEmployeeManagerDto,
  ) {
    return this.employees.assignManager(request.user, id, dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER)
  update(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(request.user, id, dto);
  }
}
