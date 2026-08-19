import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import type { Theme } from '../config/bootstrap.service';

const STORAGE_KEY = 'fh.theme';

/**
 * Light, dark, or follow the operating system.
 *
 * The stored copy is not a second source of truth — the server is — but it is read by an
 * inline script in index.html before Angular has loaded, which is what prevents the white
 * flash before the dark theme applies. Waiting for /bootstrap to resolve the theme means
 * showing the wrong one first, every time.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  readonly preference = signal<Theme>(this.readStored() ?? 'SYSTEM');
  private readonly systemPrefersDark = signal(this.media?.matches ?? false);

  constructor() {
    this.media?.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));

    effect(() => {
      const preference = this.preference();
      const dark = preference === 'DARK' || (preference === 'SYSTEM' && this.systemPrefersDark());
      const root = this.document.documentElement;

      root.dataset['theme'] = dark ? 'dark' : 'light';
      // Tells the browser to render native form controls and scrollbars to match, which
      // is the difference between a themed application and a themed stylesheet.
      root.style.colorScheme = dark ? 'dark' : 'light';

      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, preference);
    });
  }

  set(theme: Theme): void {
    this.preference.set(theme);
  }

  private readStored(): Theme | null {
    const stored = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
    return stored === 'LIGHT' || stored === 'DARK' || stored === 'SYSTEM' ? stored : null;
  }
}
