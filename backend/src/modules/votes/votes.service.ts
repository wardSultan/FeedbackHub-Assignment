import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { Principal } from '../auth/principal';

export interface VoteResult {
  voteCount: number;
  hasVoted: boolean;
}

/**
 * Casting and withdrawing a vote.
 *
 * Both operations are idempotent, which is a deliberate choice rather than a side effect.
 * A vote button is double-clicked, a mobile connection retries a request it already
 * delivered, a user hits the endpoint twice from two tabs — in every case the honest
 * answer is the same final state and the same status code, not a 409 the client has to
 * interpret.
 *
 * Neither method takes a user id. The composite primary key on `votes` is
 * (request_id, user_id), and the user comes from the verified token, so "a user may vote
 * at most once" needs no ownership lookup at all: the key *is* the rule, and there is no
 * field in the request for a caller to tamper with.
 *
 * The counter on feedback_requests is maintained by a database trigger, so it is read back
 * after the write rather than adjusted here. See ADR-0009.
 */
@Injectable()
export class VotesService {
  constructor(private readonly prisma: PrismaService) {}

  async cast(requestId: string, principal: Principal): Promise<VoteResult> {
    await this.requireLiveRequest(requestId);

    // createMany with skipDuplicates compiles to INSERT ... ON CONFLICT DO NOTHING, so
    // two concurrent casts settle to one row without either failing. A read-then-insert
    // would lose that race and surface as a 500 on a double-click.
    await this.prisma.vote.createMany({
      data: { requestId, userId: principal.userId },
      skipDuplicates: true,
    });

    return this.currentState(requestId, principal.userId);
  }

  async withdraw(requestId: string, principal: Principal): Promise<VoteResult> {
    await this.requireLiveRequest(requestId);

    // deleteMany rather than delete: removing a vote that is not there is success, not a
    // missing-record error.
    await this.prisma.vote.deleteMany({ where: { requestId, userId: principal.userId } });

    return this.currentState(requestId, principal.userId);
  }

  private async requireLiveRequest(requestId: string): Promise<void> {
    const request = await this.prisma.feedbackRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      select: { id: true },
    });

    if (!request) {
      throw new NotFoundException('That feedback request does not exist.');
    }
  }

  /** Returned so an optimistic client can reconcile against the authoritative count. */
  private async currentState(requestId: string, userId: string): Promise<VoteResult> {
    const [request, vote] = await Promise.all([
      this.prisma.feedbackRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { voteCount: true },
      }),
      this.prisma.vote.findUnique({
        where: { requestId_userId: { requestId, userId } },
        select: { userId: true },
      }),
    ]);

    return { voteCount: request.voteCount, hasVoted: vote !== null };
  }
}
