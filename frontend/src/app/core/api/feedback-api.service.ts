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

  list(query: ListQuery, pageSize: number): Observable<Paged<FeedbackRequestView>> {
    let params = new HttpParams().set('page', query.page).set('pageSize', pageSize);

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
}
