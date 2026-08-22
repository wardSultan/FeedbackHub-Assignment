import {
  DEFAULT_PAGE_SIZE,
  hasActiveFilters,
  pageCount,
  parseListQuery,
  toQueryParams,
  type ListDefaults,
} from './list-query';

const plain: ListDefaults = { sort: 'NEWEST', statuses: [], categories: [] };
const personalised: ListDefaults = {
  sort: 'MOST_VOTED',
  statuses: ['planned'],
  categories: ['bug'],
};

describe('parseListQuery', () => {
  it('uses the defaults when the URL says nothing', () => {
    expect(parseListQuery({}, personalised)).toEqual({
      q: null,
      statuses: ['planned'],
      categories: ['bug'],
      mine: false,
      sort: 'MOST_VOTED',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  // The distinction the whole parameter design rests on: absent means "inherit my
  // default", empty means "I cleared it". Collapsing them makes clearing a filter
  // impossible for anyone who has a default set.
  it('treats an explicitly empty parameter as an override, not as absence', () => {
    expect(parseListQuery({ status: '' }, personalised).statuses).toEqual([]);
    expect(parseListQuery({}, personalised).statuses).toEqual(['planned']);
  });

  it('accepts a comma-separated list and trims it', () => {
    expect(parseListQuery({ status: ' new , planned ' }, plain).statuses).toEqual([
      'new',
      'planned',
    ]);
  });

  // Sort keys appear in links people share and outlive releases.
  it('falls back when the sort key is unrecognised', () => {
    expect(parseListQuery({ sort: 'BANANAS' }, personalised).sort).toBe('MOST_VOTED');
  });
});

describe('page numbers', () => {
  ['0', '-3', 'abc', '2.5', ''].forEach((value) => {
    it(`clamps ${JSON.stringify(value)} to 1`, () => {
      expect(parseListQuery({ page: value }, plain).page).toBe(1);
    });
  });

  it('keeps a valid page', () => {
    expect(parseListQuery({ page: '4' }, plain).page).toBe(4);
  });
});

describe('toQueryParams', () => {
  it('omits everything that matches the defaults, so the common URL is clean', () => {
    expect(toQueryParams(parseListQuery({}, personalised), personalised)).toEqual({
      q: null,
      status: null,
      category: null,
      mine: null,
      sort: null,
      page: null,
      pageSize: null,
    });
  });

  it('includes only what the user changed', () => {
    const query = parseListQuery({ sort: 'OLDEST', page: '3' }, plain);
    expect(toQueryParams(query, plain)).toEqual({
      q: null,
      status: null,
      category: null,
      mine: null,
      sort: 'OLDEST',
      page: '3',
      pageSize: null,
    });
  });
});

describe('round trip', () => {
  const cases = [
    {
      q: null,
      statuses: [],
      categories: [],
      mine: false,
      sort: 'NEWEST' as const,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    },
    {
      q: 'dark mode',
      statuses: ['new', 'planned'],
      categories: ['bug'],
      mine: true,
      sort: 'MOST_VOTED' as const,
      page: 4,
      pageSize: 50 as const,
    },
    {
      q: null,
      statuses: [],
      categories: ['feature'],
      mine: false,
      sort: 'OLDEST' as const,
      page: 1,
      pageSize: 10 as const,
    },
  ];

  // The URL *is* the state, so anything lost in conversion is state the user loses on
  // refresh or on following their own shared link.
  [plain, personalised].forEach((defaults, index) => {
    cases.forEach((query, caseIndex) => {
      it(`survives case ${caseIndex} against defaults ${index}`, () => {
        expect(parseListQuery(toQueryParams(query, defaults), defaults)).toEqual(query);
      });
    });
  });
});

describe('hasActiveFilters', () => {
  it('is false for an unfiltered list', () => {
    expect(hasActiveFilters(parseListQuery({}, plain))).toBe(false);
  });

  it('is true once anything narrows it', () => {
    expect(hasActiveFilters(parseListQuery({ q: 'dark' }, plain))).toBe(true);
    expect(hasActiveFilters(parseListQuery({ status: 'new' }, plain))).toBe(true);
    expect(hasActiveFilters(parseListQuery({ mine: 'true' }, plain))).toBe(true);
  });
});

describe('page size', () => {
  it('defaults when the URL says nothing', () => {
    expect(parseListQuery({}, plain).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('accepts an offered size', () => {
    expect(parseListQuery({ pageSize: '50' }, plain).pageSize).toBe(50);
  });

  // The API answers 400 above 100, so a value from outside the set has to degrade here or
  // the address bar becomes a way to produce an error page.
  ['5000', '0', '-20', '7', 'lots', ''].forEach((value) => {
    it(`falls back for ${JSON.stringify(value)}`, () => {
      expect(parseListQuery({ pageSize: value }, plain).pageSize).toBe(DEFAULT_PAGE_SIZE);
    });
  });

  it('is omitted from the URL when it is the default', () => {
    expect(toQueryParams(parseListQuery({}, plain), plain)['pageSize']).toBeNull();
    expect(toQueryParams(parseListQuery({ pageSize: '50' }, plain), plain)['pageSize']).toBe('50');
  });
});

describe('pageCount', () => {
  it('rounds a partial last page up', () => {
    expect(pageCount(41, 20)).toBe(3);
    expect(pageCount(40, 20)).toBe(2);
  });

  // One page, not zero: the pager reads "Page 1 of 1" rather than "Page 1 of 0".
  it('never reports fewer than one page', () => {
    expect(pageCount(0, 20)).toBe(1);
  });
});
