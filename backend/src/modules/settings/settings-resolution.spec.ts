import {
  CODE_DEFAULTS,
  parseFilterSelection,
  resolveSettings,
  type GlobalDefaults,
  type UserOverrides,
} from './settings-resolution';

const global: GlobalDefaults = {
  defaultTheme: 'DARK',
  defaultLanguage: 'de',
  defaultSort: 'MOST_VOTED',
  defaultFilters: { statuses: ['planned'], categories: ['bug'] },
};

/** Every column NULL — a user who has never changed a setting. */
const noOverrides: UserOverrides = {
  theme: null,
  language: null,
  defaultSort: null,
  defaultFilters: null,
  notifyOnComment: null,
};

describe('precedence', () => {
  it('falls back to code defaults when nothing is configured', () => {
    expect(resolveSettings(null, null)).toEqual(CODE_DEFAULTS);
  });

  it('prefers a global default over the code default', () => {
    expect(resolveSettings(global, null).theme).toBe('DARK');
  });

  it('treats an all-null override row as inheriting, not as switching everything off', () => {
    expect(resolveSettings(global, noOverrides).theme).toBe('DARK');
  });

  it('prefers a user override over the global default', () => {
    expect(resolveSettings(global, { ...noOverrides, theme: 'LIGHT' }).theme).toBe('LIGHT');
  });

  it('leaves the other settings alone when one is overridden', () => {
    expect(resolveSettings(global, { ...noOverrides, theme: 'LIGHT' }).defaultSort).toBe(
      'MOST_VOTED',
    );
  });

  // The property the whole design exists for: an administrator changing a default reaches
  // every user who never customised it. Materialising defaults per user would break this.
  it('reverts to the current global default after an override is cleared', () => {
    expect(resolveSettings({ ...global, defaultTheme: 'LIGHT' }, noOverrides).theme).toBe('LIGHT');
  });
});

describe('filters', () => {
  it('inherits the global selection when the user has none', () => {
    expect(resolveSettings(global, noOverrides).defaultFilters).toEqual({
      statuses: ['planned'],
      categories: ['bug'],
    });
  });

  it('honours an explicitly empty selection rather than treating it as absent', () => {
    const overrides = { ...noOverrides, defaultFilters: { statuses: [], categories: [] } };
    expect(resolveSettings(global, overrides).defaultFilters).toEqual({
      statuses: [],
      categories: [],
    });
  });

  it.each([['nonsense'], [42], [[1, 2, 3]], [true]])(
    'degrades to the next layer when the stored blob is %p',
    (value) => {
      expect(resolveSettings(global, { ...noOverrides, defaultFilters: value }).defaultFilters)
        .toEqual({ statuses: ['planned'], categories: ['bug'] });
    },
  );

  it('drops entries that are not non-empty strings', () => {
    const overrides = {
      ...noOverrides,
      defaultFilters: { statuses: ['planned', 7, null, ''], categories: [] },
    };
    expect(resolveSettings(global, overrides).defaultFilters).toEqual({
      statuses: ['planned'],
      categories: [],
    });
  });

  it('returns null for a blob that is not an object, so the caller can fall through', () => {
    expect(parseFilterSelection(null)).toBeNull();
    expect(parseFilterSelection([])).toBeNull();
    expect(parseFilterSelection('x')).toBeNull();
  });
});

describe('notification preference', () => {
  it('has no global layer and falls to the code default', () => {
    expect(resolveSettings(global, noOverrides).notifyOnComment).toBe(true);
  });

  // false is a decision, not an absence. A `||` here instead of `??` would silently
  // re-enable notifications for everyone who turned them off.
  it('treats false as an override rather than as unset', () => {
    expect(resolveSettings(global, { ...noOverrides, notifyOnComment: false }).notifyOnComment)
      .toBe(false);
  });
});
