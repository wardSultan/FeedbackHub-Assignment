import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { assertCanDelete, assertCanEditContent } from '../auth/ownership';
import type { Principal } from '../auth/principal';
import type { ListFeedbackRequestsDto } from './dto/list-feedback-requests.dto';
import type {
  CreateFeedbackRequestDto,
  UpdateFeedbackRequestDto,
} from './dto/write-feedback-request.dto';
import { SettingsService } from '../settings/settings.service';
import { FeedbackRepository, type FeedbackRequestRow } from './feedback.repository';

export interface FeedbackRequestView {
  id: string;
  title: string;
  description: string;
  isPinned: boolean;
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: { slug: string; name: string; color: string };
  status: { slug: string; name: string; color: string };
  author: { id: string; displayName: string; avatarUrl: string | null };
  /** Capability hints for the UI. Never the enforcement — the server re-decides on write. */
  canEdit: boolean;
  canDelete: boolean;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: FeedbackRepository,
    private readonly settings: SettingsService,
  ) {}

  async list(
    principal: Principal | undefined,
    query: ListFeedbackRequestsDto,
  ): Promise<PagedResult<FeedbackRequestView>> {
    if (query.mine && !principal) {
      throw new BadRequestException('Filtering by your own requests requires signing in.');
    }

    const filters = {
      viewerId: principal?.userId ?? null,
      statuses: query.status?.length ? query.status : null,
      categories: query.category?.length ? query.category : null,
      authorId: query.mine && principal ? principal.userId : null,
      query: query.q ?? null,
      // With no explicit sort, a search should lead with relevance and a plain listing
      // with the newest. The ranking term is inert when there is no query, so NEWEST is
      // the right default for both.
      sort: query.sort ?? 'NEWEST',
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    } as const;

    const rows = await this.repository.list(filters);

    // The window function carries the total on every row, so the common case costs no
    // extra query. A page past the end returns no rows to carry it, and only then is the
    // count worth a second round trip — reporting zero there would tell a client the
    // board is empty when it is merely finished.
    const total =
      rows.length > 0
        ? Number(rows[0]!.total_count)
        : query.page > 1
          ? await this.repository.count(filters)
          : 0;

    return {
      items: rows.map((row) => this.toView(row, principal)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNext: query.page * query.pageSize < total,
    };
  }

  async findOne(id: string, principal: Principal | undefined): Promise<FeedbackRequestView> {
    const row = await this.repository.findOne(id, principal?.userId ?? null);

    if (!row) {
      throw new NotFoundException('That feedback request does not exist.');
    }

    return this.toView(row, principal);
  }

  /**
   * Creating a request casts the author's own vote in the same transaction.
   *
   * Submitting a request is itself an expression of support, and a request showing zero
   * votes from its own author reads as broken. Recorded as an interpretation in
   * docs/SCOPE.md, A-16, because the brief does not say either way.
   */
  /**
   * The administrator-configurable submission limit.
   *
   * Distinct from the global throttle in front of the API: that one protects the
   * infrastructure from any caller, this is a *product* rule about how much one person may
   * file. Conflating them is a common miss — they have different owners, different units
   * and different reasons to change.
   *
   * Deleted requests still count. Otherwise the limit is bypassed by submitting, deleting
   * and submitting again, which is neither obscure nor hard to discover.
   *
   * Two simultaneous submissions can both pass this check and take the count one over the
   * limit. That is accepted rather than locked against: this is a courtesy rule about
   * volume, not a security boundary, and serialising every submission to enforce it
   * exactly would cost more than the off-by-one is worth.
   */
  private async assertWithinSubmissionLimit(principal: Principal): Promise<void> {
    const { submissionLimitCount, submissionLimitWindowHours } =
      await this.settings.getAppSettings();

    const since = new Date(Date.now() - submissionLimitWindowHours * 60 * 60 * 1000);

    const recent = await this.prisma.feedbackRequest.count({
      where: { authorId: principal.userId, createdAt: { gte: since } },
    });

    if (recent >= submissionLimitCount) {
      throw new HttpException(
        {
          message:
            `You have submitted ${recent} requests in the last ` +
            `${submissionLimitWindowHours} hours, which is the current limit. ` +
            `Please try again later.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async create(principal: Principal, dto: CreateFeedbackRequestDto): Promise<FeedbackRequestView> {
    await this.assertWithinSubmissionLimit(principal);

    const [category, status] = await Promise.all([
      this.prisma.category.findFirst({ where: { slug: dto.categorySlug, isActive: true } }),
      this.prisma.status.findFirst({ where: { isDefault: true } }),
    ]);

    if (!category) {
      throw new BadRequestException({
        message: 'The request could not be created.',
        errors: { categorySlug: ['That category does not exist or is no longer available.'] },
      });
    }
    if (!status) {
      // The migration seeds a default status, so this means the taxonomy was edited into
      // an unusable state rather than that the caller did something wrong.
      throw new BadRequestException('No default status is configured.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.feedbackRequest.create({
        data: {
          title: dto.title,
          description: dto.description,
          categoryId: category.id,
          statusId: status.id,
          authorId: principal.userId,
        },
        select: { id: true },
      });

      await tx.vote.create({ data: { requestId: request.id, userId: principal.userId } });

      return request;
    });

    return this.findOne(created.id, principal);
  }

  async updateContent(
    id: string,
    principal: Principal,
    dto: UpdateFeedbackRequestDto,
  ): Promise<FeedbackRequestView> {
    const existing = await this.requireExisting(id);
    // Authorization in the service, not only in a decorator: a future caller that is not
    // an HTTP controller still passes through here.
    assertCanEditContent(principal, existing);

    let categoryId: string | undefined;
    if (dto.categorySlug) {
      const category = await this.prisma.category.findFirst({
        where: { slug: dto.categorySlug, isActive: true },
      });
      if (!category) {
        throw new BadRequestException({
          message: 'The request could not be updated.',
          errors: { categorySlug: ['That category does not exist or is no longer available.'] },
        });
      }
      categoryId = category.id;
    }

    await this.prisma.feedbackRequest.update({
      where: { id },
      data: { title: dto.title, description: dto.description, categoryId },
    });

    return this.findOne(id, principal);
  }

  async remove(id: string, principal: Principal): Promise<void> {
    const existing = await this.requireExisting(id);
    assertCanDelete(principal, existing);

    // Soft delete: moderation should be reversible, and hard-deleting a request would
    // destroy a discussion many people contributed to. See docs/SCOPE.md, A-8.
    await this.prisma.feedbackRequest.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async setStatus(
    id: string,
    principal: Principal,
    statusSlug: string,
  ): Promise<FeedbackRequestView> {
    await this.requireExisting(id);

    const status = await this.prisma.status.findFirst({
      where: { slug: statusSlug, isActive: true },
    });
    if (!status) {
      throw new BadRequestException({
        message: 'The status could not be changed.',
        errors: { statusSlug: ['That status does not exist or is no longer available.'] },
      });
    }

    await this.prisma.feedbackRequest.update({ where: { id }, data: { statusId: status.id } });
    return this.findOne(id, principal);
  }

  async setPinned(id: string, principal: Principal, pinned: boolean): Promise<FeedbackRequestView> {
    await this.requireExisting(id);

    // pinned_at is not decoration: the database CHECK requires it to be present exactly
    // when is_pinned is true, and it is what orders pinned items among themselves.
    await this.prisma.feedbackRequest.update({
      where: { id },
      data: { isPinned: pinned, pinnedAt: pinned ? new Date() : null },
    });

    return this.findOne(id, principal);
  }

  private async requireExisting(id: string): Promise<{ id: string; authorId: string }> {
    const existing = await this.repository.findOwnership(id);

    if (!existing) {
      throw new NotFoundException('That feedback request does not exist.');
    }

    return existing;
  }

  private toView(row: FeedbackRequestRow, principal: Principal | undefined): FeedbackRequestView {
    const isAuthor = principal?.userId === row.author_id;
    const isAdmin = principal?.role === 'ADMIN';

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      isPinned: row.is_pinned,
      voteCount: row.vote_count,
      commentCount: row.comment_count,
      hasVoted: row.has_voted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      category: { slug: row.category_slug, name: row.category_name, color: row.category_color },
      status: { slug: row.status_slug, name: row.status_name, color: row.status_color },
      author: {
        id: row.author_id,
        displayName: row.author_display_name,
        avatarUrl: row.author_avatar_url,
      },
      canEdit: isAuthor,
      canDelete: isAuthor || isAdmin,
    };
  }
}
