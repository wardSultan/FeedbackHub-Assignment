/**
 * Resolving effective settings from global defaults and per-user overrides.
 *
 * Deliberately a pure function over plain data, with no database and no framework. It is
 * the rule the brief asks about directly — "how it is resolved between global defaults and
 * user overrides" — so it should be readable and testable on its own rather than tangled
 * into a service method.
 *
 * The precedence is three layers deep:
 *
 *     code default  →  global default (app_settings)  →  user override (user_settings)
 *
 * The code defaults are not decoration. They keep the application coherent against a
 * partially migrated or hand-edited database, and they cover the one setting that has no
 * global column at all.
 *
 * The rule that matters most: in `user_settings`, NULL means *inherit*, not *off*. That is
 * what makes an administrator changing a global default propagate to every user who never
 * customised it. Materialising the defaults into each user's row at signup would look
 * equivalent and would silently break that.
 */

export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM';
export type ListSort = 'NEWEST' | 'OLDEST' | 'MOST_VOTED' | 'MOST_COMMENTED' | 'RECENTLY_UPDATED';

export interface ListFilterSelection {
  statuses: string[];
  categories: string[];
}

export interface EffectiveSettings {
  theme: Theme;
  language: string;
  defaultSort: ListSort;
  defaultFilters: ListFilterSelection;
  notifyOnComment: boolean;
}

export interface GlobalDefaults {
  defaultTheme: Theme;
  defaultLanguage: string;
  defaultSort: ListSort;
  defaultFilters: unknown;
}

export interface UserOverrides {
  theme: Theme | null;
  language: string | null;
  defaultSort: ListSort | null;
  defaultFilters: unknown;
  notifyOnComment: boolean | null;
}

/** The floor. Applies when neither the user nor the administrator has expressed a view. */
export const CODE_DEFAULTS: EffectiveSettings = {
  theme: 'SYSTEM',
  language: 'en',
  defaultSort: 'NEWEST',
  defaultFilters: { statuses: [], categories: [] },
  // No global column: notification preference is inherently per-person, and defaulting it
  // on is what makes "email me about comments on my requests" work without being asked.
  notifyOnComment: true,
};

/**
 * The filter blob is JSON, so it can be anything. Anything that is not a list of strings
 * is treated as absent rather than trusted or thrown over: a malformed preference should
 * degrade to "no filter", never break the page that reads it.
 */
export function parseFilterSelection(value: unknown): ListFilterSelection | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const toSlugList = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [];

  return {
    statuses: toSlugList(record['statuses']),
    categories: toSlugList(record['categories']),
  };
}

export function resolveSettings(
  global: GlobalDefaults | null,
  overrides: UserOverrides | null,
): EffectiveSettings {
  const globalFilters = parseFilterSelection(global?.defaultFilters);
  const userFilters = parseFilterSelection(overrides?.defaultFilters);

  return {
    theme: overrides?.theme ?? global?.defaultTheme ?? CODE_DEFAULTS.theme,
    language: overrides?.language ?? global?.defaultLanguage ?? CODE_DEFAULTS.language,
    defaultSort: overrides?.defaultSort ?? global?.defaultSort ?? CODE_DEFAULTS.defaultSort,
    defaultFilters: userFilters ?? globalFilters ?? CODE_DEFAULTS.defaultFilters,
    notifyOnComment: overrides?.notifyOnComment ?? CODE_DEFAULTS.notifyOnComment,
  };
}
