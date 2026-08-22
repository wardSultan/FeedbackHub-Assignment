import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { ListSortValue } from './dto/list-feedback-requests.dto';

export interface ListFilters {
  viewerId: string | null;
  statuses: string[] | null;
  categories: string[] | null;
  authorId: string | null;
  query: string | null;
  sort: ListSortValue;
  limit: number;
  offset: number;
}

export interface FeedbackRequestRow {
  id: string;
  title: string;
  description: string;
  is_pinned: boolean;
  pinned_at: Date | null;
  vote_count: number;
  comment_count: number;
  created_at: Date;
  updated_at: Date;
  category_slug: string;
  category_name: string;
  category_color: string;
  status_slug: string;
  status_name: string;
  status_color: string;
  author_id: string;
  author_display_name: string;
  author_avatar_url: string | null;
  has_voted: boolean;
  total_count: bigint;
}

/**
 * The list query is raw SQL rather than a Prisma `findMany`.
 *
 * Three things it has to do at once are awkward or impossible through the query builder:
 * relevance ranking with `ts_rank`, "pinned first under every sort", and a per-viewer
 * `has_voted` flag — plus the total count in the same round trip via a window function.
 * Written out, it is one readable statement; assembled through the builder it would be a
 * pile of conditional fragments.
 *
 * Every value is a bound parameter, including the sort key, which is compared as text
 * rather than interpolated into the ORDER BY. Nothing from the request reaches the
 * statement as SQL.
 *
 * Verified as written by prisma/checks/list-query.sql, which runs the same query against a
 * real database across the filter, sort, search and pagination matrix.
 */
@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The filter predicate, shared by the list and the count.
   *
   * Extracted so the two cannot disagree. A count that drifts from the list it counts is
   * the classic pagination bug: the page numbers describe a different result set than the
   * rows, and it shows up only at the last page where nobody looks.
   */
  private matching(
    filters: Pick<ListFilters, 'statuses' | 'categories' | 'authorId' | 'query'>,
  ): Prisma.Sql {
    const { statuses, categories, authorId, query } = filters;

    return Prisma.sql`
       WHERE r.deleted_at IS NULL
         AND (${statuses}::text[]   IS NULL OR s.slug = ANY(${statuses}::text[]))
         AND (${categories}::text[] IS NULL OR c.slug = ANY(${categories}::text[]))
         AND (${authorId}::uuid     IS NULL OR r.author_id = ${authorId}::uuid)
         AND (${query}::text        IS NULL OR r.search_vector @@ websearch_to_tsquery('english', ${query}))
    `;
  }

  /**
   * How many rows the filters match, regardless of which page was asked for.
   *
   * Needed only when a page lands past the end: the window function below reads the total
   * off the first row, and a page with no rows has none to read it from. Without this, a
   * request for page 99 reports a total of zero — which reads as "the board is empty"
   * rather than "you have gone too far", and leaves the pager with nothing to return to.
   */
  async count(filters: ListFilters): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT count(*) AS total
        FROM feedback_requests r
        JOIN categories c ON c.id = r.category_id
        JOIN statuses   s ON s.id = r.status_id
        ${this.matching(filters)}
    `);

    return Number(rows[0]?.total ?? 0);
  }

  list(filters: ListFilters): Promise<FeedbackRequestRow[]> {
    const { viewerId, query, sort, limit, offset } = filters;

    return this.prisma.$queryRaw<FeedbackRequestRow[]>(Prisma.sql`
      SELECT r.id,
             r.title,
             r.description,
             r.is_pinned,
             r.pinned_at,
             r.vote_count,
             r.comment_count,
             r.created_at,
             r.updated_at,
             c.slug  AS category_slug,
             c.name  AS category_name,
             c.color AS category_color,
             s.slug  AS status_slug,
             s.name  AS status_name,
             s.color AS status_color,
             u.id           AS author_id,
             u.display_name AS author_display_name,
             u.avatar_url   AS author_avatar_url,
             (v.user_id IS NOT NULL) AS has_voted,
             count(*) OVER () AS total_count
        FROM feedback_requests r
        JOIN categories c ON c.id = r.category_id
        JOIN statuses   s ON s.id = r.status_id
        JOIN users      u ON u.id = r.author_id
        LEFT JOIN votes v ON v.request_id = r.id AND v.user_id = ${viewerId}::uuid
        ${this.matching(filters)}
       ORDER BY r.is_pinned DESC,
                r.pinned_at DESC NULLS LAST,
                CASE WHEN ${query}::text IS NULL THEN 0
                     ELSE -ts_rank(r.search_vector, websearch_to_tsquery('english', ${query})) END,
                CASE WHEN ${sort} = 'MOST_VOTED'     THEN -r.vote_count
                     WHEN ${sort} = 'MOST_COMMENTED' THEN -r.comment_count END,
                CASE WHEN ${sort} = 'OLDEST'           THEN r.created_at END ASC,
                CASE WHEN ${sort} = 'RECENTLY_UPDATED' THEN r.updated_at END DESC,
                r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
  }

  /** Detail view. Same projection as the list so both render from one shape. */
  async findOne(id: string, viewerId: string | null): Promise<FeedbackRequestRow | undefined> {
    const rows = await this.prisma.$queryRaw<FeedbackRequestRow[]>`
      SELECT r.id, r.title, r.description, r.is_pinned, r.pinned_at,
             r.vote_count, r.comment_count, r.created_at, r.updated_at,
             c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
             s.slug AS status_slug,   s.name AS status_name,   s.color AS status_color,
             u.id AS author_id, u.display_name AS author_display_name,
             u.avatar_url AS author_avatar_url,
             (v.user_id IS NOT NULL) AS has_voted,
             1::bigint AS total_count
        FROM feedback_requests r
        JOIN categories c ON c.id = r.category_id
        JOIN statuses   s ON s.id = r.status_id
        JOIN users      u ON u.id = r.author_id
        LEFT JOIN votes v ON v.request_id = r.id AND v.user_id = ${viewerId}::uuid
       WHERE r.id = ${id}::uuid AND r.deleted_at IS NULL
    `;

    return rows[0];
  }

  /** Ownership lookup — deliberately minimal, and never trusts a caller-supplied author. */
  findOwnership(id: string): Promise<{ id: string; authorId: string } | null> {
    return this.prisma.feedbackRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, authorId: true },
    });
  }
}
