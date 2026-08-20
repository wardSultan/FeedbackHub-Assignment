import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  SettingsApiService,
  type SettingsResponse,
  type UserOverrides,
} from '../../core/api/settings-api.service';
import { BootstrapService, type ListSort, type Theme } from '../../core/config/bootstrap.service';
import { ThemeService } from '../../core/theme/theme.service';
import { messageFrom } from '../../core/http/problem-details';
import { ErrorStateComponent, LoadingListComponent } from '../../shared/ui/state-views.component';

/**
 * Two layers, shown as two layers.
 *
 * Every control offers "Use the default" alongside its explicit values, because the
 * difference between *choosing* dark and *inheriting* dark is invisible otherwise — and
 * without it there is no way to go back, which makes the global default unreachable once
 * a user has touched anything.
 */
@Component({
  selector: 'fh-settings',
  standalone: true,
  imports: [
    FormsModule,
    LowerCasePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    LoadingListComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly api = inject(SettingsApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly bootstrap = inject(BootstrapService);
  protected readonly theme = inject(ThemeService);

  protected readonly settings = signal<SettingsResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly displayName = signal('');

  /** `null` is a real option here, not an absence — it is how an override is cleared. */
  protected readonly themes: { value: Theme | null; label: string }[] = [
    { value: null, label: 'Use the default' },
    { value: 'LIGHT', label: 'Light' },
    { value: 'DARK', label: 'Dark' },
    { value: 'SYSTEM', label: 'Match my system' },
  ];

  protected readonly sorts: { value: ListSort | null; label: string }[] = [
    { value: null, label: 'Use the default' },
    { value: 'NEWEST', label: 'Newest' },
    { value: 'OLDEST', label: 'Oldest' },
    { value: 'MOST_VOTED', label: 'Most voted' },
    { value: 'MOST_COMMENTED', label: 'Most discussed' },
    { value: 'RECENTLY_UPDATED', label: 'Recently updated' },
  ];

  constructor() {
    this.displayName.set(this.bootstrap.user()?.displayName ?? '');
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.mySettings().subscribe({
      next: (response) => {
        this.settings.set(response);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(messageFrom(error, 'Your settings could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  /** True when the value shown is inherited rather than chosen — drives the "default" hint. */
  protected inherited(field: keyof UserOverrides): boolean {
    return this.settings()?.overrides[field] === null;
  }

  protected patch(patch: Partial<UserOverrides>): void {
    this.saving.set(true);

    this.api.updateMySettings(patch).subscribe({
      next: (response) => {
        this.settings.set(response);
        this.saving.set(false);
        // The theme applies immediately rather than on the next page load: a preview you
        // have to reload to see is not a preview.
        this.theme.set(response.effective.theme);
        void this.bootstrap.refresh();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.snackBar.open(messageFrom(error, 'That change could not be saved.'), 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  protected saveProfile(): void {
    const name = this.displayName().trim();
    if (!name) return;

    this.saving.set(true);
    this.api.updateProfile({ displayName: name }).subscribe({
      next: () => {
        this.saving.set(false);
        void this.bootstrap.refresh();
        this.snackBar.open('Profile updated.', undefined, { duration: 3000 });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.snackBar.open(messageFrom(error, 'Your profile could not be saved.'), 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  protected deleteAccount(): void {
    // Destructive, irreversible, and it is worth saying what actually happens: the content
    // stays, attributed to "Deleted user". People assume deletion removes their comments.
    const confirmed = confirm(
      'Delete your account?\n\n' +
        'Your requests and comments will stay on the board, attributed to "Deleted user", ' +
        'so other people\'s discussions are not broken. This cannot be undone.',
    );
    if (!confirmed) return;

    this.api.deleteAccount().subscribe({
      next: () => void this.router.navigate(['/requests']),
      error: (error: unknown) =>
        this.snackBar.open(
          messageFrom(error, 'Your account could not be deleted.'),
          'Dismiss',
          { duration: 8000 },
        ),
    });
  }
}
