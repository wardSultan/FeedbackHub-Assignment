import { Injectable, NotFoundException } from '@nestjs/common';
import { CommentModerationStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { assertCanDelete, assertCanEditContent, isAdmin } from '../auth/ownership';
import type { Principal } from '../auth/principal';
import { SettingsService } from '../settings/settings.service';
import type { ListCommentsDto, WriteCommentDto } from './dto/comment.dto';

export interface CommentView {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  moderationStatus: CommentModerationStatus;
  /** True when this comment is visible only to its author and administrators. */
  awaitingApproval: boolean;
  author: { id: string; displayName: string; avatarUrl: string | null };
  canEdit: boolean;
  canDelete: boolean;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * A pending comment is visible to its author and to administrators, and to nobody else.
   *
   * Showing an author their own comment in a "awaiting approval" state matters: hiding it
   * outright looks like the submission failed, and people re-post. Filtering this in the
   * query rather than in the response mapping is what makes it an authorization rule
   * rather than a presentation detail.
   */
  private visibilityFilter(principal: Principal | undefined): Prisma.CommentWhereInput {
    if (principal && isAdmin(principal)) {
      return {};
    }

    const visible: Prisma.CommentWhereInput[] = [
      { moderationStatus: CommentModerationStatus.APPROVED },
    ];

    if (principal) {
      visible.push({ authorId: principal.userId });
    }

    return { OR: visible };
  }

  async list(
    requestId: string,
    principal: Principal | undefined,
    paging: ListCommentsDto,
  ): Promise<{ items: CommentView[]; page: number; pageSize: number; total: number }> {
    await this.requireLiveRequest(requestId);

    const where: Prisma.CommentWhereInput = {
      requestId,
      deletedAt: null,
      ...this.visibilityFilter(principal),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (paging.page - 1) * paging.pageSize,
        take: paging.pageSize,
        include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
      }),
      this.prisma.comment.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toView(row, principal)),
      page: paging.page,
      pageSize: paging.pageSize,
      total,
    };
  }

  async create(
    requestId: string,
    principal: Principal,
    dto: WriteCommentDto,
  ): Promise<CommentView> {
    await this.requireLiveRequest(requestId);

    const created = await this.prisma.comment.create({
      data: {
        requestId,
        authorId: principal.userId,
        body: dto.body,
        moderationStatus: await this.initialModerationStatus(principal),
      },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    return this.toView(created, principal);
  }

  async update(id: string, principal: Principal, dto: WriteCommentDto): Promise<CommentView> {
    const existing = await this.requireExisting(id);
    // Author only. An administrator may remove this comment but may not rewrite it and
    // leave someone else's name on it.
    assertCanEditContent(principal, existing);

    const updated = await this.prisma.comment.update({
      where: { id },
      data: {
        body: dto.body,
        editedAt: new Date(),
        // Editing re-enters the queue when approval is required. Without this, moderation
        // is trivially bypassed: post something innocuous, wait for approval, then edit it
        // into whatever you actually wanted to say.
        moderationStatus: await this.initialModerationStatus(principal),
      },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    return this.toView(updated, principal);
  }

  async remove(id: string, principal: Principal): Promise<void> {
    const existing = await this.requireExisting(id);
    assertCanDelete(principal, existing);

    await this.prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Administrators are the moderators, so queueing their own comments for their own
   * approval would be theatre. Recorded as an interpretation in docs/SCOPE.md, A-22.
   */
  private async initialModerationStatus(principal: Principal): Promise<CommentModerationStatus> {
    if (principal.role === UserRole.ADMIN) {
      return CommentModerationStatus.APPROVED;
    }

    const { commentsRequireApproval } = await this.settings.getAppSettings();

    return commentsRequireApproval
      ? CommentModerationStatus.PENDING
      : CommentModerationStatus.APPROVED;
  }

  private async requireExisting(id: string): Promise<{ id: string; authorId: string }> {
    const existing = await this.prisma.comment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true },
    });

    if (!existing) {
      throw new NotFoundException('That comment does not exist.');
    }

    return existing;
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

  private toView(
    row: {
      id: string;
      body: string;
      createdAt: Date;
      editedAt: Date | null;
      moderationStatus: CommentModerationStatus;
      authorId: string;
      author: { id: string; displayName: string; avatarUrl: string | null };
    },
    principal: Principal | undefined,
  ): CommentView {
    const author = principal?.userId === row.authorId;

    return {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      moderationStatus: row.moderationStatus,
      awaitingApproval: row.moderationStatus === CommentModerationStatus.PENDING,
      author: row.author,
      canEdit: author,
      canDelete: author || (principal !== undefined && isAdmin(principal)),
    };
  }
}
