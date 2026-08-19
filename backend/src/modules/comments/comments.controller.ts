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
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { RequiresFeature } from '../settings/requires-feature.decorator';
import { CommentsService, type CommentView } from './comments.service';
import { ListCommentsDto, WriteCommentDto } from './dto/comment.dto';

export const COMMENTS_FEATURE = 'comments.enabled';

/**
 * Every route here is gated on the `comments.enabled` flag, writes included.
 *
 * Turning the flag off hides the comment section in the user interface *and* makes these
 * endpoints refuse. A flag enforced only in the browser is a preference, not a flag: the
 * routes are still live for anyone who opens a terminal.
 */
@ApiTags('comments')
@ApiBearerAuth()
@RequiresFeature(COMMENTS_FEATURE)
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('requests/:requestId/comments')
  @ApiOperation({ summary: 'List the comments on a request' })
  list(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() principal: Principal,
    @Query() paging: ListCommentsDto,
  ): Promise<{ items: CommentView[]; page: number; pageSize: number; total: number }> {
    return this.comments.list(requestId, principal, paging);
  }

  @Post('requests/:requestId/comments')
  @ApiOperation({ summary: 'Comment on a request' })
  create(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() principal: Principal,
    @Body() dto: WriteCommentDto,
  ): Promise<CommentView> {
    return this.comments.create(requestId, principal, dto);
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Edit your own comment' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: WriteCommentDto,
  ): Promise<CommentView> {
    return this.comments.update(id, principal, dto);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your own comment, or any comment as an administrator' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    return this.comments.remove(id, principal);
  }
}
