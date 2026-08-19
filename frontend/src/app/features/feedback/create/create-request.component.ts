import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';
import { BootstrapService } from '../../../core/config/bootstrap.service';
import { fieldErrorsFrom, messageFrom } from '../../../core/http/problem-details';

@Component({
  selector: 'fh-create-request',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a class="back" routerLink="/requests">
        <mat-icon aria-hidden="true">arrow_back</mat-icon> Back to the board
      </a>
      <h1>New request</h1>
      <p class="hint">
        Search the board first — if your idea is already there, voting for it counts for
        more than a duplicate.
      </p>

      @if (formError()) {
        <p class="form-error" role="alert">{{ formError() }}</p>
      }

      <form (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>Title</mat-label>
          <input matInput name="title" required [ngModel]="title()"
                 (ngModelChange)="title.set($event)"
                 [attr.aria-invalid]="!!errors()['title']"
                 aria-describedby="title-error" />
          <mat-hint align="end">{{ title().length }} / 120</mat-hint>
          @if (errors()['title']) {
            <mat-error id="title-error">{{ errors()['title'] }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput name="description" rows="8" required [ngModel]="description()"
                    (ngModelChange)="description.set($event)"
                    [attr.aria-invalid]="!!errors()['description']"
                    aria-describedby="description-error"></textarea>
          @if (errors()['description']) {
            <mat-error id="description-error">{{ errors()['description'] }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Category</mat-label>
          <mat-select name="categorySlug" required [value]="categorySlug()"
                      (valueChange)="categorySlug.set($event)">
            @for (category of bootstrap.categories(); track category.slug) {
              <mat-option [value]="category.slug">{{ category.name }}</mat-option>
            }
          </mat-select>
          @if (errors()['categorySlug']) {
            <mat-error>{{ errors()['categorySlug'] }}</mat-error>
          }
        </mat-form-field>

        <div class="actions">
          <a mat-button routerLink="/requests">Cancel</a>
          <button mat-flat-button type="submit" [disabled]="saving()">
            {{ saving() ? 'Submitting…' : 'Submit request' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styleUrl: './create-request.component.scss',
})
export class CreateRequestComponent {
  private readonly api = inject(FeedbackApiService);
  private readonly router = inject(Router);
  protected readonly bootstrap = inject(BootstrapService);

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly categorySlug = signal('');
  protected readonly saving = signal(false);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly formError = signal<string | null>(null);

  protected submit(): void {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errors.set({});
    this.formError.set(null);

    this.api
      .create({
        title: this.title(),
        description: this.description(),
        categorySlug: this.categorySlug(),
      })
      .subscribe({
        next: (created) => void this.router.navigate(['/requests', created.id]),
        error: (error: unknown) => {
          this.saving.set(false);
          // Field errors go next to their inputs; anything else goes to the top of the
          // form. Input the user typed is never cleared on failure.
          const fieldErrors = fieldErrorsFrom(error);
          this.errors.set(fieldErrors);
          if (Object.keys(fieldErrors).length === 0) {
            this.formError.set(messageFrom(error, 'The request could not be submitted.'));
          }
        },
      });
  }
}
