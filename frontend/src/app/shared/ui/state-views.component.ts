import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * The three states every list and detail view has to handle, as shared components rather
 * than as markup repeated per feature — which is how they end up inconsistent, and how the
 * empty state quietly goes missing from the screen nobody demoed.
 */

@Component({
  selector: 'fh-loading-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Skeletons matching the real card, so nothing shifts when the data lands. A centred
         spinner tells the user to wait; a skeleton tells them what they are waiting for. -->
    <div class="skeletons" role="status" aria-live="polite" aria-busy="true">
      <span class="visually-hidden">Loading requests…</span>
      @for (row of rows(); track row) {
        <div class="skeleton-card" aria-hidden="true">
          <div class="skeleton-vote"></div>
          <div class="skeleton-body">
            <div class="skeleton-line title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './state-views.component.scss',
})
export class LoadingListComponent {
  readonly count = input(3);
  protected rows(): number[] {
    return Array.from({ length: this.count() }, (_, index) => index);
  }
}

@Component({
  selector: 'fh-empty-state',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state">
      <mat-icon class="state-icon" aria-hidden="true">{{ icon() }}</mat-icon>
      <h2 class="state-title">{{ title() }}</h2>
      <p class="state-message">{{ message() }}</p>
      @if (actionLabel()) {
        <button mat-flat-button (click)="action.emit()">{{ actionLabel() }}</button>
      }
    </div>
  `,
  styleUrl: './state-views.component.scss',
})
export class EmptyStateComponent {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly actionLabel = input<string | null>(null);
  readonly action = output<void>();
}

@Component({
  selector: 'fh-error-state',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- role=alert so a screen reader is told the request failed rather than being left on
         a page that silently stopped updating. -->
    <div class="state error" role="alert">
      <mat-icon class="state-icon" aria-hidden="true">error_outline</mat-icon>
      <h2 class="state-title">{{ title() }}</h2>
      <p class="state-message">{{ message() }}</p>
      <button mat-flat-button (click)="retry.emit()">Try again</button>
    </div>
  `,
  styleUrl: './state-views.component.scss',
})
export class ErrorStateComponent {
  readonly title = input('Something went wrong');
  readonly message = input('The request could not be loaded.');
  readonly retry = output<void>();
}
