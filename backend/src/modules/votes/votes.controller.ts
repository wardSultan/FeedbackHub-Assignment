import { Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/principal';
import { VotesService, type VoteResult } from './votes.service';

/**
 * No request body and no user identifier in the path: the request comes from the URL and
 * the voter from the token. There is nothing here for a caller to tamper with, which is
 * why these two endpoints need no ownership check.
 */
@ApiTags('votes')
@ApiBearerAuth()
@Controller('requests/:id/vote')
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  @Post()
  @ApiOperation({ summary: 'Vote for a request (idempotent)' })
  @ApiOkResponse({ description: 'The authoritative vote count after the change.' })
  cast(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() principal: Principal,
  ): Promise<VoteResult> {
    return this.votes.cast(requestId, principal);
  }

  @Delete()
  @ApiOperation({ summary: 'Withdraw your vote (idempotent)' })
  @ApiOkResponse({ description: 'The authoritative vote count after the change.' })
  withdraw(
    @Param('id', ParseUUIDPipe) requestId: string,
    @CurrentUser() principal: Principal,
  ): Promise<VoteResult> {
    return this.votes.withdraw(requestId, principal);
  }
}
