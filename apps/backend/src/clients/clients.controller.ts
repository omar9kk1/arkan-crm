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
import type { AuthUser } from '@arkan/shared';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients.query';
import { CreateClientFollowUpDto } from './dto/create-follow-up.dto';

/**
 * Client endpoints for both roles.
 *
 * The global `JwtAuthGuard` + `RolesGuard` already require a valid session;
 * this controller deliberately sets no class-level `@Roles`, because employees
 * are allowed here — row-level scoping lives in `clientOwnershipWhere` so an
 * employee only ever sees clients they created or are responsible for.
 * Unauthorised reads answer 404 (never 403) so record existence never leaks.
 */
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListClientsQueryDto,
  ) {
    return this.clients.list(request.user, query);
  }

  // Declared before ':id' so the static segment always wins the route match.
  @Get('stats')
  stats(@Req() request: { user: AuthUser }) {
    return this.clients.stats(request.user);
  }

  @Get(':id')
  findOne(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clients.findOne(request.user, id);
  }

  @Post()
  create(@Req() request: { user: AuthUser }, @Body() body: CreateClientDto) {
    return this.clients.create(request.user, body);
  }

  @Patch(':id')
  update(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateClientDto,
  ) {
    return this.clients.update(request.user, id, body);
  }

  @Post(':id/follow-ups')
  createFollowUp(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateClientFollowUpDto,
  ) {
    return this.clients.createFollowUp(request.user, id, body);
  }
}
