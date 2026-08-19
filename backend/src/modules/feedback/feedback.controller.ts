import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { ListFeedbackRequestsDto } from './dto/list-feedback-requests.dto';
import {
  CreateFeedbackRequestDto,
  SetPinnedDto,
  SetStatusDto,
  UpdateFeedbackRequestDto,
} from './dto/write-feedback-request.dto';
import { FeedbackService, type FeedbackRequestView, type PagedResult } from './feedback.service';

/**
 * Mutating a request is three endpoints, not one PATCH with a permission matrix inside:
 * editing content is the author's, changing status and pinning are the administrator's.
 * Splitting them means each rule is guarded and tested independently, and the two cannot
 * be conflated by a body field.
 */
@ApiTags('feedback')
@ApiBearerAuth()
@Controller('requests')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: 'List feedback requests' })
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ListFeedbackRequestsDto,
  ): Promise<PagedResult<FeedbackRequestView>> {
    return this.feedback.list(principal, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single feedback request' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<FeedbackRequestView> {
    return this.feedback.findOne(id, principal);
  }

  @Post()
  @ApiOperation({ summary: 'Submit a feedback request' })
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreateFeedbackRequestDto,
  ): Promise<FeedbackRequestView> {
    return this.feedback.create(principal, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit your own request' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateFeedbackRequestDto,
  ): Promise<FeedbackRequestView> {
    return this.feedback.updateContent(id, principal, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your own request, or any request as an administrator' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    return this.feedback.remove(id, principal);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Triage: set the status of a request' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: SetStatusDto,
  ): Promise<FeedbackRequestView> {
    return this.feedback.setStatus(id, principal, dto.statusSlug);
  }

  @Patch(':id/pin')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Pin or unpin a request' })
  setPinned(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: SetPinnedDto,
  ): Promise<FeedbackRequestView> {
    return this.feedback.setPinned(id, principal, dto.pinned);
  }
}
