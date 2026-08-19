import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import {
  FeedbackApiService,
  type FeedbackRequestView,
} from '../../../core/api/feedback-api.service';
import { BootstrapService } from '../../../core/config/bootstrap.service';

@Component({
  selector: 'fh-request-card',
  standalone: true,
  imports: [RouterLink, DatePipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [class.pinned]="request().isPinned">
      <!-- A real button with aria-pressed, not a styled div: the vote control is the most
           used thing on the page and has to work from the keyboard. -->
      <button
        class="vote"
        type="button"
        [class.voted]="voted()"
        [attr.aria-pressed]="voted()"
        [attr.aria-label]="
          (voted() ? 'Withdraw your vote from ' : 'Vote for ') + request().title
        "
        [disabled]="busy() || !bootstrap.isSignedIn()"
        (click)="toggleVote()">
        <mat-icon aria-hidden="true">expand_less</mat-icon>
        <span class="count">{{ votes() }}</span>
      </button>

      <div class="body">
        @if (request().isPinned) {
          <span class="pin"><mat-icon aria-hidden="true">push_pin</mat-icon> Pinned</span>
        }
        <h3 class="title">
          <a [routerLink]="['/requests', request().id]">{{ request().title }}</a>
        </h3>
        <p class="excerpt">{{ request().description }}</p>
        <div class="meta">
          <span class="tag" [style.--tag-color]="request().status.color">
            {{ request().status.name }}
          </span>
          <span class="tag subtle" [style.--tag-color]="request().category.color">
            {{ request().category.name }}
          </span>
          <span class="muted">{{ request().author.displayName }}</span>
          <span class="muted">{{ request().createdAt | date: 'mediumDate' }}</span>
          <span class="muted comments">
            <mat-icon aria-hidden="true">mode_comment</mat-icon>
            {{ request().commentCount }}
          </span>
        </div>
      </div>
    </article>
  `,
  styleUrl: './request-card.component.scss',
})
export class RequestCardComponent {
  private readonly api = inject(FeedbackApiService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly bootstrap = inject(BootstrapService);

  readonly request = input.required<FeedbackRequestView>();

  /** Local overrides so a vote feels instant; null means "use whatever the server said". */
  private readonly optimisticVoted = signal<boolean | null>(null);
  private readonly optimisticVotes = signal<number | null>(null);
  protected readonly busy = signal(false);

  protected readonly voted = computed(() => this.optimisticVoted() ?? this.request().hasVoted);
  protected readonly votes = computed(() => this.optimisticVotes() ?? this.request().voteCount);

  protected toggleVote(): void {
    if (this.busy() || !this.bootstrap.isSignedIn()) {
      return;
    }

    const wasVoted = this.voted();
    const previousVotes = this.votes();

    this.busy.set(true);
    this.optimisticVoted.set(!wasVoted);
    this.optimisticVotes.set(previousVotes + (wasVoted ? -1 : 1));

    const request$ = wasVoted
      ? this.api.withdrawVote(this.request().id)
      : this.api.vote(this.request().id);

    request$.subscribe({
      // The server returns the authoritative count, so the optimistic guess is replaced
      // rather than merely confirmed — two people voting at once still converge.
      next: (result) => {
        this.optimisticVoted.set(result.hasVoted);
        this.optimisticVotes.set(result.voteCount);
        this.busy.set(false);
      },
      error: () => {
        this.optimisticVoted.set(null);
        this.optimisticVotes.set(null);
        this.busy.set(false);
        this.snackBar.open('Your vote could not be saved. Please try again.', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }
}
