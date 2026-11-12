import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { ListDealClientsQueryDto } from './dto/list-deal-clients.query';
import { ListDealsQueryDto } from './dto/list-deals.query';

/**
 * Deals are a management surface (OWNER/MANAGER only). EMPLOYEE access is
 * rejected by the same global RolesGuard used everywhere else.
 */
@Roles(Role.OWNER, Role.MANAGER)
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListDealsQueryDto,
  ) {
    return this.deals.list(request.user, query);
  }

  /** Picker data for the existing create wizard. */
  @Get('options')
  options(@Req() request: { user: AuthUser }) {
    return this.deals.options(request.user);
  }

  /** Searchable, authorised client picker for step 2. */
  @Get('client-options')
  clientOptions(
    @Req() request: { user: AuthUser },
    @Query() query: ListDealClientsQueryDto,
  ) {
    return this.deals.clientOptions(request.user, query);
  }

  @Get(':id')
  get(@Req() request: { user: AuthUser }, @Param('id') id: string) {
    return this.deals.get(request.user, id);
  }

  @Post()
  create(@Req() request: { user: AuthUser }, @Body() body: CreateDealDto) {
    return this.deals.create(request.user, body);
  }
}
