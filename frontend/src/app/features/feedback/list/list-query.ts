/**
 * The list's state lives in the URL.
 *
 * That is a deliberate choice rather than a shortcut around a store: it makes a filtered
 * view shareable, makes the back button work, survives a refresh, and removes the entire
 * class of bug where client state and the address bar disagree. The cost is this file —
 * the conversion has to be exact in both directions.
 *
 * Pure functions over plain objects, with no Angular imports, so the conversion can be
 * tested (and executed) on its own.
 */

export const LIST_SORTS = [
  'NEWEST',
  'OLDEST',
  'MOST_VOTED',
  'MOST_COMMENTED',
  'RECENTLY_UPDATED',
] as const;

export type ListSort = (typeof LIST_SORTS)[number];

export interface ListQuery {
  q: string | null;
  statuses: string[];
  categories: string[];
  mine: boolean;
  sort: ListSort;
  page: number;
}

/** What the user's settings say, used for anything the URL does not specify. */
export interface ListDefaults {
  sort: ListSort;
  statuses: string[];
  categories: string[];
}

export type RawParams = Record<string, string | undefined | null>;

const isSort = (value: unknown): value is ListSort =>
  typeof value === 'string' && (LIST_SORTS as readonly string[]).includes(value);

/** `?status=new,planned` and a repeated `?status=new&status=planned` both arrive as text. */
function parseList(value: string | undefined | null): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  // An explicitly empty parameter means "no filter", which is different from the parameter
  // being absent — absent inherits the user's default, empty overrides it with nothing.
  return items;
}

function parsePage(value: string | undefined | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function parseListQuery(params: RawParams, defaults: ListDefaults): ListQuery {
  const statuses = parseList(params['status']);
  const categories = parseList(params['category']);
  const sort = params['sort'];

  return {
    q: params['q']?.trim() ? params['q'].trim() : null,
    statuses: statuses ?? defaults.statuses,
    categories: categories ?? defaults.categories,
    mine: params['mine'] === 'true',
    // An unrecognised sort falls back rather than failing. Sort keys appear in shared
    // links and outlive releases; a removed one should degrade, not produce an error page.
    sort: isSort(sort) ? sort : defaults.sort,
    page: parsePage(params['page']),
  };
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The inverse. Anything equal to the default is omitted, so the common case is a clean URL
 * and only what the user actually changed shows up in the address bar.
 *
 * `null` rather than `undefined` for omitted keys: Angular's router removes a query
 * parameter set to null and ignores one set to undefined, and the difference is the
 * difference between a filter clearing and a filter sticking.
 */
export function toQueryParams(query: ListQuery, defaults: ListDefaults): RawParams {
  return {
    q: query.q?.trim() ? query.q.trim() : null,
    status: sameList(query.statuses, defaults.statuses) ? null : query.statuses.join(','),
    category: sameList(query.categories, defaults.categories) ? null : query.categories.join(','),
    mine: query.mine ? 'true' : null,
    sort: query.sort === defaults.sort ? null : query.sort,
    page: query.page > 1 ? String(query.page) : null,
  };
}

/** Whether anything is narrowing the list — drives the "clear filters" affordance and the
 *  choice between the "nothing here yet" and "nothing matches" empty states. */
export function hasActiveFilters(query: ListQuery): boolean {
  return Boolean(query.q) || query.statuses.length > 0 || query.categories.length > 0 || query.mine;
}
