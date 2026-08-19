import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RUNTIME_CONFIG } from '../config/runtime-config';
import type { Paged } from './feedback-api.service';

export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  moderationStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  awaitingApproval: boolean;
  author: { id: string; displayName: string; avatarUrl: string | null };
  canEdit: boolean;
  canDelete: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(RUNTIME_CONFIG).apiUrl}/api/v1`;

  list(requestId: string, page = 1): Observable<Paged<CommentView>> {
    return this.http.get<Paged<CommentView>>(`${this.base}/requests/${requestId}/comments`, {
      params: new HttpParams().set('page', page).set('pageSize', 50),
    });
  }

  create(requestId: string, body: string): Observable<CommentView> {
    return this.http.post<CommentView>(`${this.base}/requests/${requestId}/comments`, { body });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/comments/${id}`);
  }
}
