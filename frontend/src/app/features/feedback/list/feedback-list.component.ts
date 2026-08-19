import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';
import { BootstrapService } from '../../../core/config/bootstrap.service';
import {
  EmptyStateComponent,
  ErrorStateComponent,
  LoadingListComponent,
} from '../../../shared/ui/state-views.component';
import { RequestCardComponent } from './request-card.component';
import { LIST_SORTS, hasActiveFilters, parseListQuery, toQueryParams } from './list-query';

const PAGE_SIZE = 20;

/**
 * The board.
 *
 * The query parameters are the state. Every control writes to the URL and the list is
 * derived from what the URL says — never the other way round — so there is only one place
 * the current view is recorded and no way for the two to drift apart.
 */
@Component({
  selector: 'fh-feedback-list',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    LoadingListComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    RequestCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './feedback-list.component.html',
  styleUrl: './feedback-list.component.scss',
})
export class FeedbackListComponent {
  private readonly api = inject(FeedbackApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly bootstrap = inject(BootstrapService);

  protected readonly sorts = LIST_SORTS;
  protected readonly sortLabels: Record<string, string> = {
    NEWEST: 'Newest',
    OLDEST: 'Oldest',
    MOST_VOTED: 'Most voted',
    MOST_COMMENTED: 'Most discussed',
    RECENTLY_UPDATED: 'Recently updated',
  };

  private readonly defaults = computed(() => {
    const settings = this.bootstrap.settings();
    return {
      sort: settings?.defaultSort ?? ('NEWEST' as const),
      statuses: settings?.defaultFilters.statuses ?? [],
      categories: settings?.defaultFilters.categories ?? [],
    };
  });

  private readonly params = toSignal(
    this.route.queryParams.pipe(map((params) => params as Record<string, string | undefined>)),
    { initialValue: {} as Record<string, string | undefined> },
  );

  protected readonly query = computed(() => parseListQuery(this.params(), this.defaults()));
  protected readonly filtered = computed(() => hasActiveFilters(this.query()));

  /** Bound to the search box. Kept separate from the URL so typing does not navigate on
   *  every keystroke — it is committed on submit. */
  protected readonly searchText = signal('');

  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly result = signal<{ items: unknown[]; total: number; hasNext: boolean } | null>(
    null,
  );

  private readonly requests = signal<import('../../../core/api/feedback-api.service').FeedbackRequestView[]>([]);
  protected readonly items = computed(() => this.requests());

  constructor() {
    // Re-fetch whenever the URL changes — which is the only way the view can change.
    this.route.queryParams.subscribe(() => this.fetch());
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(false);

    this.api.list(this.query(), PAGE_SIZE).subscribe({
      next: (page) => {
        this.requests.set(page.items);
        this.result.set({ items: page.items, total: page.total, hasNext: page.hasNext });
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  protected applySearch(): void {
    this.patch({ q: this.searchText().trim() || null, page: 1 });
  }

  protected toggleStatus(slug: string): void {
    const current = this.query().statuses;
    this.patch({
      statuses: current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
      page: 1,
    });
  }

  protected toggleCategory(slug: string): void {
    const current = this.query().categories;
    this.patch({
      categories: current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
      page: 1,
    });
  }

  protected setSort(sort: string): void {
    this.patch({ sort: sort as (typeof LIST_SORTS)[number], page: 1 });
  }

  protected toggleMine(): void {
    this.patch({ mine: !this.query().mine, page: 1 });
  }

  protected goToPage(page: number): void {
    this.patch({ page });
  }

  protected clearFilters(): void {
    this.searchText.set('');
    // Empty rather than undefined: an explicitly empty filter overrides a personal default,
    // where an absent one would silently re-apply it and look like the clear failed.
    this.patch({ q: null, statuses: [], categories: [], mine: false, page: 1 });
  }

  private patch(changes: Partial<ReturnType<typeof parseListQuery>>): void {
    const next = { ...this.query(), ...changes };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next, this.defaults()),
      // Merge so a parameter set to null is removed rather than the whole set being
      // replaced, which is what keeps unrelated parameters intact.
      queryParamsHandling: 'merge',
    });
  }
}
