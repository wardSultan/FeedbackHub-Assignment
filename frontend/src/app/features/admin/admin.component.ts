import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin } from 'rxjs';
import {
  SettingsApiService,
  type AppSettings,
  type FeatureFlag,
} from '../../core/api/settings-api.service';
import { BootstrapService, type TaxonomyTerm } from '../../core/config/bootstrap.service';
import { messageFrom } from '../../core/http/problem-details';
import { ErrorStateComponent, LoadingListComponent } from '../../shared/ui/state-views.component';

type TermKind = 'categories' | 'statuses';

@Component({
  selector: 'fh-admin',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTabsModule,
    LoadingListComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  private readonly api = inject(SettingsApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly bootstrap = inject(BootstrapService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly categories = signal<TaxonomyTerm[]>([]);
  protected readonly statuses = signal<TaxonomyTerm[]>([]);
  protected readonly settings = signal<AppSettings | null>(null);
  protected readonly flags = signal<FeatureFlag[]>([]);

  protected readonly newCategory = signal('');
  protected readonly newStatus = signal('');

  protected readonly policies = [
    { value: 'OPEN' as const, label: 'Open — anyone with an account may join' },
    { value: 'INVITE_ONLY' as const, label: 'Invite only — an administrator adds addresses' },
    { value: 'DOMAIN_RESTRICTED' as const, label: 'Restricted to specific email domains' },
  ];

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      categories: this.api.allCategories(),
      statuses: this.api.allStatuses(),
      settings: this.api.appSettings(),
      flags: this.api.featureFlags(),
    }).subscribe({
      next: ({ categories, statuses, settings, flags }) => {
        this.categories.set(categories);
        this.statuses.set(statuses);
        this.settings.set(settings);
        this.flags.set(flags);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(messageFrom(error, 'The administration data could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected addTerm(kind: TermKind): void {
    const source = kind === 'categories' ? this.newCategory : this.newStatus;
    const name = source().trim();
    if (!name) return;

    this.api.createTerm(kind, name).subscribe({
      next: () => {
        source.set('');
        this.reloadTaxonomy();
      },
      error: (error: unknown) => this.report(error, 'That term could not be added.'),
    });
  }

  /**
   * Retiring, not deleting. A retired term disappears from the create form and stays on
   * the requests that already use it, which is what "retires an unused one" asks for.
   */
  protected setActive(kind: TermKind, term: TaxonomyTerm, isActive: boolean): void {
    this.api.updateTerm(kind, term.id, { isActive }).subscribe({
      next: () => this.reloadTaxonomy(),
      error: (error: unknown) => this.report(error, 'That term could not be updated.'),
    });
  }

  protected makeDefault(term: TaxonomyTerm): void {
    this.api.updateTerm('statuses', term.id, { isDefault: true }).subscribe({
      next: () => this.reloadTaxonomy(),
      error: (error: unknown) => this.report(error, 'The default status could not be changed.'),
    });
  }

  /** Deleting is refused with 409 when the term is in use; the message says to retire it. */
  protected deleteTerm(kind: TermKind, term: TaxonomyTerm): void {
    if (!confirm(`Delete “${term.name}”? Retiring it is usually what you want instead.`)) return;

    this.api.deleteTerm(kind, term.id).subscribe({
      next: () => this.reloadTaxonomy(),
      error: (error: unknown) => this.report(error, 'That term could not be deleted.'),
    });
  }

  protected saveSettings(patch: Partial<AppSettings>): void {
    this.api.updateAppSettings(patch).subscribe({
      next: (updated) => {
        this.settings.set(updated);
        void this.bootstrap.refresh();
        this.snackBar.open('Settings saved.', undefined, { duration: 2500 });
      },
      error: (error: unknown) => this.report(error, 'Those settings could not be saved.'),
    });
  }

  protected toggleFlag(flag: FeatureFlag, enabled: boolean): void {
    this.api.setFeatureFlag(flag.key, enabled).subscribe({
      next: () => {
        this.flags.update((all) => all.map((f) => (f.key === flag.key ? { ...f, enabled } : f)));
        // Refreshing the bootstrap payload is what makes the change visible immediately
        // rather than on the next full page load.
        void this.bootstrap.refresh();
      },
      error: (error: unknown) => this.report(error, 'That flag could not be changed.'),
    });
  }

  private reloadTaxonomy(): void {
    forkJoin({ categories: this.api.allCategories(), statuses: this.api.allStatuses() }).subscribe({
      next: ({ categories, statuses }) => {
        this.categories.set(categories);
        this.statuses.set(statuses);
        void this.bootstrap.refresh();
      },
      error: (error: unknown) => this.report(error, 'The taxonomy could not be reloaded.'),
    });
  }

  private report(error: unknown, fallback: string): void {
    this.snackBar.open(messageFrom(error, fallback), 'Dismiss', { duration: 6000 });
  }
}
