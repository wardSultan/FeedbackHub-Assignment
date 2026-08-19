import { toSlug } from './taxonomy.service';

describe('toSlug', () => {
  it.each([
    ['Bug', 'bug'],
    ['Feature Request', 'feature-request'],
    ['  Under Review  ', 'under-review'],
    ['UI / UX', 'ui-ux'],
    ['Won’t fix', 'won-t-fix'],
    ['C++ support', 'c-support'],
    ['Améliorations', 'ameliorations'],
    ['日本語', '日本語'],
  ])('turns %j into %j', (input, expected) => {
    expect(toSlug(input)).toBe(expected);
  });

  it('keeps letters from non-Latin alphabets rather than discarding them', () => {
    // A naive /[^a-z0-9]/ would reduce this to an empty string and the term would be
    // rejected for a reason the administrator could not act on.
    expect(toSlug('Ünicode Wörter')).toBe('unicode-worter');
  });

  it('returns an empty string when there is nothing to slug, so the caller can refuse', () => {
    expect(toSlug('!!!')).toBe('');
    expect(toSlug('   ')).toBe('');
  });

  it('never exceeds the column length', () => {
    expect(toSlug('a'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});
