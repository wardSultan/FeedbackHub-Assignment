import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { CommentsApiService, type CommentView } from '../../../core/api/comments-api.service';
import {
  FeedbackApiService,
  type FeedbackRequestView,
} from '../../../core/api/feedback-api.service';
import { BootstrapService } from '../../../core/config/bootstrap.service';
import { messageFrom } from '../../../core/http/problem-details';
import {
  EmptyStateComponent,
  ErrorStateComponent,
  LoadingListComponent,
} from '../../../shared/ui/state-views.component';

export const COMMENTS_FEATURE = 'comments.enabled';

@Component({
  selector: 'fh-request-detail',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    LoadingListComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-detail.component.html',
  styleUrl: './request-detail.component.scss',
})
export class RequestDetailComponent {
  private readonly api = inject(FeedbackApiService);
  private readonly commentsApi = inject(CommentsApiService);
  protected readonly bootstrap = inject(BootstrapService);

  /** Bound from the route by withComponentInputBinding(). */
  readonly id = input.required<string>();

  protected readonly request = signal<FeedbackRequestView | null>(null);
  protected readonly comments = signal<CommentView[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = signal('');
  protected readonly posting = signal(false);
  protected readonly commentError = signal<string | null>(null);

  /**
   * The flag is read from the bootstrap payload, so switching it off removes the section
   * without a reload. It is not the enforcement — the API refuses these endpoints under
   * the same flag, which is what stops anyone with a terminal from posting anyway.
   */
  protected readonly commentsEnabled = computed(() => this.bootstrap.isEnabled(COMMENTS_FEATURE));

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.get(this.id()).subscribe({
      next: (request) => {
        this.request.set(request);
        this.loading.set(false);
        if (this.commentsEnabled()) {
          this.loadComments();
        }
      },
      error: (error: unknown) => {
        this.error.set(messageFrom(error, 'That request could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  private loadComments(): void {
    this.commentsApi.list(this.id()).subscribe({
      next: (page) => this.comments.set(page.items),
      error: () => this.commentError.set('The discussion could not be loaded.'),
    });
  }

  protected postComment(): void {
    const body = this.draft().trim();

    if (!body || this.posting()) {
      return;
    }

    this.posting.set(true);
    this.commentError.set(null);

    this.commentsApi.create(this.id(), body).subscribe({
      next: (comment) => {
        this.comments.update((current) => [...current, comment]);
        this.draft.set('');
        this.posting.set(false);
      },
      error: (error: unknown) => {
        this.posting.set(false);
        this.commentError.set(messageFrom(error, 'Your comment could not be posted.'));
      },
    });
  }

  protected deleteComment(comment: CommentView): void {
    if (!confirm('Delete this comment? This cannot be undone.')) {
      return;
    }

    this.commentsApi.remove(comment.id).subscribe({
      next: () => this.comments.update((all) => all.filter((c) => c.id !== comment.id)),
      error: (error: unknown) =>
        this.commentError.set(messageFrom(error, 'The comment could not be deleted.')),
    });
  }
}
