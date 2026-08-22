import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RUNTIME_CONFIG } from '../config/runtime-config';
import type { ListQuery } from '../../features/feedback/list/list-query';

export interface FeedbackRequestView {
  id: string;
  title: string;
  description: string;
  isPinned: boolean;
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  createdAt: string;
  updatedAt: string;
  category: { slug: string; name: string; color: string };
  status: { slug: string; name: string; color: string };
  author: { id: string; displayName: string; avatarUrl: string | null };
  canEdit: boolean;
  canDelete: boolean;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

@Injectable({ providedIn: 'root' })
export class FeedbackApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(RUNTIME_CONFIG).apiUrl}/api/v1`;

  list(query: ListQuery): Observable<Paged<FeedbackRequestView>> {
    // Page size travels with the rest of the query rather than as a separate argument, so
    // there is one description of the current view and no way for a caller to request a
    // size the URL does not reflect.
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);

    if (query.q) params = params.set('q', query.q);
    if (query.mine) params = params.set('mine', 'true');
    // Repeated keys rather than a comma list: this is what HttpParams produces naturally
    // and what the API's array transform accepts, and it avoids escaping questions about
    // slugs that might one day contain a comma.
    for (const slug of query.statuses) params = params.append('status', slug);
    for (const slug of query.categories) params = params.append('category', slug);
    params = params.set('sort', query.sort);

    return this.http.get<Paged<FeedbackRequestView>>(`${this.base}/requests`, { params });
  }

  get(id: string): Observable<FeedbackRequestView> {
    return this.http.get<FeedbackRequestView>(`${this.base}/requests/${id}`);
  }

  vote(id: string): Observable<{ voteCount: number; hasVoted: boolean }> {
    return this.http.post<{ voteCount: number; hasVoted: boolean }>(
      `${this.base}/requests/${id}/vote`,
      {},
    );
  }

  withdrawVote(id: string): Observable<{ voteCount: number; hasVoted: boolean }> {
    return this.http.delete<{ voteCount: number; hasVoted: boolean }>(
      `${this.base}/requests/${id}/vote`,
    );
  }

  create(body: {
    title: string;
    description: string;
    categorySlug: string;
  }): Observable<FeedbackRequestView> {
    return this.http.post<FeedbackRequestView>(`${this.base}/requests`, body);
  }

  /**
   * Triage: move a request to another status. Administrators only.
   *
   * Separate from `update` rather than a field on it, mirroring the API: editing your own
   * wording and deciding what the product team will do about it are different acts with
   * different authorization, and one endpoint carrying both would have to re-decide per
   * field. Each returns the whole updated request, so the caller replaces its copy rather
   * than patching fields and hoping the two agree.
   */
  setStatus(id: string, statusSlug: string): Observable<FeedbackRequestView> {
    return this.http.patch<FeedbackRequestView>(`${this.base}/requests/${id}/status`, {
      statusSlug,
    });
  }

  /** Pin or unpin. Pinned requests lead the board under every sort. Administrators only. */
  setPinned(id: string, pinned: boolean): Observable<FeedbackRequestView> {
    return this.http.patch<FeedbackRequestView>(`${this.base}/requests/${id}/pin`, { pinned });
  }

  /** Soft-delete. The author may remove their own; an administrator may remove any. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${id}`);
  }
}
