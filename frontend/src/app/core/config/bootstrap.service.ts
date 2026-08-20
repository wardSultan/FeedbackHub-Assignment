import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RUNTIME_CONFIG } from './runtime-config';

export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM';
export type ListSort = 'NEWEST' | 'OLDEST' | 'MOST_VOTED' | 'MOST_COMMENTED' | 'RECENTLY_UPDATED';

export interface TaxonomyTerm {
  id: string;
  slug: string;
  name: string;
  color: string;
  /** Only present on the administrative endpoints, which return retired terms too. */
  isActive?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface BootstrapPayload {
  user: { userId: string; email: string; displayName: string; role: 'USER' | 'ADMIN' } | null;
  settings: {
    theme: Theme;
    language: string;
    defaultSort: ListSort;
    defaultFilters: { statuses: string[]; categories: string[] };
    notifyOnComment: boolean;
  };
  flags: Record<string, boolean>;
  taxonomy: { categories: TaxonomyTerm[]; statuses: TaxonomyTerm[] };
}

/**
 * Everything the shell needs, from one request made once during start-up.
 *
 * The alternative this exists to avoid is a chain: /me, then settings, then flags, then
 * categories, then statuses — each waiting on the last, with a blank page for the sum of
 * them. One call, and everything else loads after first paint.
 */
@Injectable({ providedIn: 'root' })
export class BootstrapService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(RUNTIME_CONFIG);

  private readonly state = signal<BootstrapPayload | null>(null);

  readonly user = computed(() => this.state()?.user ?? null);
  readonly isSignedIn = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');
  readonly settings = computed(() => this.state()?.settings ?? null);
  readonly categories = computed(() => this.state()?.taxonomy.categories ?? []);
  readonly statuses = computed(() => this.state()?.taxonomy.statuses ?? []);

  /** Unknown flags read as disabled, matching how the server evaluates them. */
  isEnabled(key: string): boolean {
    return this.state()?.flags[key] ?? false;
  }

  async load(): Promise<void> {
    const payload = await firstValueFrom(
      this.http.get<BootstrapPayload>(`${this.config.apiUrl}/api/v1/bootstrap`),
    );

    this.state.set(payload);
  }

  /** Re-read after something that changes it — a settings save, or an admin toggling a
   *  flag — so the change is visible without a page reload. */
  async refresh(): Promise<void> {
    await this.load();
  }
}
