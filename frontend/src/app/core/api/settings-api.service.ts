import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RUNTIME_CONFIG } from '../config/runtime-config';
import type { ListSort, TaxonomyTerm, Theme } from '../config/bootstrap.service';

export interface FilterSelection {
  statuses: string[];
  categories: string[];
}

export interface EffectiveSettings {
  theme: Theme;
  language: string;
  defaultSort: ListSort;
  defaultFilters: FilterSelection;
  notifyOnComment: boolean;
}

/** Null means "no override" — the value is inherited from the global default. */
export interface UserOverrides {
  theme: Theme | null;
  language: string | null;
  defaultSort: ListSort | null;
  defaultFilters: FilterSelection | null;
  notifyOnComment: boolean | null;
}

export interface SettingsResponse {
  overrides: UserOverrides;
  effective: EffectiveSettings;
}

export interface AppSettings {
  registrationPolicy: 'OPEN' | 'INVITE_ONLY' | 'DOMAIN_RESTRICTED';
  allowedEmailDomains: string[];
  commentsRequireApproval: boolean;
  submissionLimitCount: number;
  submissionLimitWindowHours: number;
  defaultTheme: Theme;
  defaultLanguage: string;
  defaultSort: ListSort;
  defaultFilters: FilterSelection;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(RUNTIME_CONFIG).apiUrl}/api/v1`;

  mySettings(): Observable<SettingsResponse> {
    return this.http.get<SettingsResponse>(`${this.base}/me/settings`);
  }

  /**
   * Sending `null` for a field clears the override and returns it to the global default;
   * omitting it leaves it untouched. That distinction is the whole settings model, so it
   * is preserved all the way from this method to the column.
   */
  updateMySettings(patch: Partial<UserOverrides>): Observable<SettingsResponse> {
    return this.http.patch<SettingsResponse>(`${this.base}/me/settings`, patch);
  }

  updateProfile(patch: { displayName?: string }): Observable<unknown> {
    return this.http.patch(`${this.base}/me`, patch);
  }

  deleteAccount(): Observable<void> {
    return this.http.delete<void>(`${this.base}/me`);
  }

  appSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.base}/admin/settings`);
  }

  updateAppSettings(patch: Partial<AppSettings>): Observable<AppSettings> {
    return this.http.patch<AppSettings>(`${this.base}/admin/settings`, patch);
  }

  featureFlags(): Observable<FeatureFlag[]> {
    return this.http.get<FeatureFlag[]>(`${this.base}/admin/feature-flags`);
  }

  setFeatureFlag(key: string, enabled: boolean): Observable<unknown> {
    return this.http.patch(`${this.base}/admin/feature-flags/${key}`, { enabled });
  }

  allCategories(): Observable<TaxonomyTerm[]> {
    return this.http.get<TaxonomyTerm[]>(`${this.base}/admin/categories`);
  }

  allStatuses(): Observable<TaxonomyTerm[]> {
    return this.http.get<TaxonomyTerm[]>(`${this.base}/admin/statuses`);
  }

  createTerm(kind: 'categories' | 'statuses', name: string): Observable<TaxonomyTerm> {
    return this.http.post<TaxonomyTerm>(`${this.base}/admin/${kind}`, { name });
  }

  updateTerm(
    kind: 'categories' | 'statuses',
    id: string,
    patch: { name?: string; isActive?: boolean; isDefault?: boolean },
  ): Observable<TaxonomyTerm> {
    return this.http.patch<TaxonomyTerm>(`${this.base}/admin/${kind}/${id}`, patch);
  }

  deleteTerm(kind: 'categories' | 'statuses', id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/${kind}/${id}`);
  }
}
