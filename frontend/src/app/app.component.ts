import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { BootstrapService } from './core/config/bootstrap.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'fh-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatButtonModule, MatIconModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- First focusable element on the page: keyboard users should not have to tab through
         the whole header to reach the list on every navigation. -->
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="app-bar">
      <a class="brand" routerLink="/requests">
        <mat-icon aria-hidden="true">forum</mat-icon>
        <span>FeedbackHub</span>
      </a>

      <nav class="nav" aria-label="Main">
        <a routerLink="/requests" routerLinkActive="active"
           [routerLinkActiveOptions]="{ exact: true }">Board</a>
        @if (bootstrap.isAdmin()) {
          <a routerLink="/admin" routerLinkActive="active">Administration</a>
        }
      </nav>

      <div class="spacer"></div>

      <button mat-icon-button [matMenuTriggerFor]="themeMenu" aria-label="Change theme">
        <mat-icon>contrast</mat-icon>
      </button>
      <mat-menu #themeMenu="matMenu">
        @for (option of themeOptions; track option.value) {
          <button mat-menu-item (click)="theme.set(option.value)"
                  [attr.aria-current]="theme.preference() === option.value">
            <mat-icon>{{ option.icon }}</mat-icon>
            <span>{{ option.label }}</span>
          </button>
        }
      </mat-menu>

      @if (bootstrap.isSignedIn()) {
        <button mat-button [matMenuTriggerFor]="userMenu">
          {{ bootstrap.user()?.displayName }}
        </button>
        <mat-menu #userMenu="matMenu">
          <a mat-menu-item routerLink="/settings">Settings</a>
          <button mat-menu-item (click)="auth.signOut()">Sign out</button>
        </mat-menu>
      } @else {
        <button mat-flat-button (click)="auth.signIn()">Sign in</button>
      }
    </header>

    <main id="main" class="app-main" tabindex="-1">
      <router-outlet />
    </main>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly bootstrap = inject(BootstrapService);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  protected readonly themeOptions = [
    { value: 'LIGHT' as const, label: 'Light', icon: 'light_mode' },
    { value: 'DARK' as const, label: 'Dark', icon: 'dark_mode' },
    { value: 'SYSTEM' as const, label: 'Match system', icon: 'computer' },
  ];
}
