import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role, type AuthUser } from '@arkan/shared';
import type { Response } from 'express';
import { parseAndValidatePayload } from '../common/validation/json-payload';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MAX_IMAGE_BYTES, type UploadedImageFile } from '../files/files.service';
import { PropertiesService } from './properties.service';
import { CreatePropertyMultipartDto } from './dto/create-property-multipart.dto';
import { CreatePropertyPayloadDto } from './dto/create-property-payload.dto';
import { UpdatePropertyPayloadDto } from './dto/update-property-payload.dto';
import { UpdatePropertyRequestDto } from './dto/update-property-request.dto';
import { ListPropertiesQueryDto } from './dto/list-properties.query';
import { ApprovePropertyDto } from './dto/approve-property.dto';
import { RejectPropertyDto } from './dto/reject-property.dto';
import { RequestChangesDto } from './dto/request-changes.dto';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  async create(
    @Req() request: { user: AuthUser },
    @Body() body: CreatePropertyMultipartDto,
    @UploadedFile() file?: UploadedImageFile,
  ) {
    const payload = await parseAndValidatePayload(
      CreatePropertyPayloadDto,
      body.payload,
    );
    return this.properties.create(request.user, payload, file);
  }

  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListPropertiesQueryDto,
  ) {
    return this.properties.list(request.user, query);
  }

  @RawResponse()
  @Get(':id/image')
  async image(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { stream, mimeType, sizeBytes } = await this.properties.openImage(
      request.user,
      id,
    );
    response.set({
      'Content-Type': mimeType,
      'Content-Length': String(sizeBytes),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  @Get(':id')
  findOne(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.properties.findOne(request.user, id);
  }

  @Patch(':id')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  async update(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePropertyRequestDto,
    @UploadedFile() file?: UploadedImageFile,
  ) {
    // A JSON body carries the fields directly; a multipart body carries them
    // in the `payload` JSON string (the replacement image travels with it).
    const payload =
      typeof body.payload === 'string'
        ? await parseAndValidatePayload(
            UpdatePropertyPayloadDto,
            body.payload,
          )
        : body;
    return this.properties.update(request.user, id, payload, file);
  }

  @Roles(Role.MANAGER)
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApprovePropertyDto,
  ) {
    return this.properties.approve(request.user, id, body);
  }

  @Roles(Role.MANAGER)
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectPropertyDto,
  ) {
    return this.properties.reject(request.user, id, body);
  }

  /** Manager-only: keep the property PENDING but ask the creator to change it. */
  @Roles(Role.MANAGER)
  @Post(':id/request-changes')
  @HttpCode(200)
  requestChanges(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RequestChangesDto,
  ) {
    return this.properties.requestChanges(request.user, id, body);
  }

  @Post(':id/resubmit')
  @HttpCode(200)
  resubmit(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.properties.resubmit(request.user, id);
  }
}
