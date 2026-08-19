import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommentModerationStatus, UserRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { Roles } from '../auth/roles.decorator';
import { CommentsService, type CommentView } from './comments.service';
import { ListCommentsDto } from './dto/comment.dto';

export class ModerateCommentDto {
  @ApiProperty({ enum: [CommentModerationStatus.APPROVED, CommentModerationStatus.REJECTED] })
  @IsIn([CommentModerationStatus.APPROVED, CommentModerationStatus.REJECTED], {
    message: 'A moderation decision must be either APPROVED or REJECTED.',
  })
  status!: typeof CommentModerationStatus.APPROVED | typeof CommentModerationStatus.REJECTED;
}

/**
 * Deliberately not gated on the comments feature flag.
 *
 * If comments are switched off while items are still queued, an administrator must still
 * be able to clear the queue — otherwise turning the feature off strands pending content
 * with no way to resolve it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/comments')
export class AdminCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Comments awaiting moderation' })
  pending(
    @CurrentUser() principal: Principal,
    @Query() paging: ListCommentsDto,
  ): Promise<{ items: CommentView[]; page: number; pageSize: number; total: number }> {
    return this.comments.listPending(principal, paging);
  }

  @Patch(':id/moderation')
  @ApiOperation({ summary: 'Approve or reject a comment' })
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: ModerateCommentDto,
  ): Promise<CommentView> {
    return this.comments.moderate(id, principal, dto.status);
  }
}
