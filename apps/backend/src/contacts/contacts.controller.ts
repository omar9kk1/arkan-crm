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
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post()
  create(@Req() request: { user: AuthUser }, @Body() body: CreateContactDto) {
    return this.contacts.create(request.user, body);
  }

  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListContactsQueryDto,
  ) {
    return this.contacts.list(request.user, query);
  }

  @Get(':id')
  findOne(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contacts.findOne(request.user, id);
  }

  @Patch(':id')
  update(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContactDto,
  ) {
    return this.contacts.update(request.user, id, body);
  }
}
