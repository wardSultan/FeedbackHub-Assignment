import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
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
    MatSelectModule,
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
  private readonly router = inject(Router);
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

  /** Triage controls. In flight, and the last failure, kept apart from the comment form. */
  protected readonly triaging = signal(false);
  protected readonly triageError = signal<string | null>(null);

  /**
   * Statuses an administrator may move a request to.
   *
   * Retired statuses are filtered out: they still have to render on requests already
   * carrying them — that is what "retire rather than delete" is for — but offering one as
   * a destination would let the board be filled with a status the taxonomy has withdrawn.
   */
  protected readonly assignableStatuses = computed(() =>
    this.bootstrap.statuses().filter((status) => status.isActive !== false),
  );

  /**
   * Whether to show the triage panel at all.
   *
   * A hint, not the control. Every endpoint behind these buttons re-decides the same
   * question, so hiding them saves an administrator-only affordance from cluttering
   * everyone else's screen and nothing more.
   */
  protected readonly canTriage = computed(() => this.bootstrap.isAdmin());

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

  protected setStatus(statusSlug: string): void {
    const current = this.request();

    // The select emits on programmatic value changes too; without this, re-rendering the
    // panel after a successful change would fire a second identical request.
    if (!current || this.triaging() || statusSlug === current.status.slug) {
      return;
    }

    this.applyTriage(this.api.setStatus(this.id(), statusSlug), 'The status could not be changed.');
  }

  protected togglePinned(): void {
    const current = this.request();

    if (!current || this.triaging()) {
      return;
    }

    this.applyTriage(
      this.api.setPinned(this.id(), !current.isPinned),
      'The request could not be pinned.',
    );
  }

  protected deleteRequest(): void {
    if (this.triaging() || !confirm('Delete this request? This cannot be undone.')) {
      return;
    }

    this.triaging.set(true);
    this.triageError.set(null);

    this.api.remove(this.id()).subscribe({
      // The request is gone, so staying on its page would show a 404 on the next reload.
      next: () => void this.router.navigate(['/requests']),
      error: (error: unknown) => {
        this.triaging.set(false);
        this.triageError.set(messageFrom(error, 'The request could not be deleted.'));
      },
    });
  }

  /**
   * Shared tail for the triage calls.
   *
   * Each returns the whole updated request and the response replaces the local copy, so
   * what is on screen is what the server stored — no optimistic guess to reconcile, which
   * matters here because a status change can be refused by rules the client does not know.
   */
  private applyTriage(
    call: ReturnType<FeedbackApiService['setStatus']>,
    fallback: string,
  ): void {
    this.triaging.set(true);
    this.triageError.set(null);

    call.subscribe({
      next: (updated) => {
        this.request.set(updated);
        this.triaging.set(false);
      },
      error: (error: unknown) => {
        this.triaging.set(false);
        this.triageError.set(messageFrom(error, fallback));
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
