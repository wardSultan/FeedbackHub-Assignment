import { decideRegistration, domainOf, type RegistrationRules } from './registration-policy';

const restricted = (domains: string[]): RegistrationRules => ({
  policy: 'DOMAIN_RESTRICTED',
  allowedEmailDomains: domains,
});

const allow = (email: string, rules: RegistrationRules, existing = false): boolean =>
  decideRegistration(email, existing, rules).allowed;

describe('domainOf', () => {
  it.each([
    ['ward@acme.com', 'acme.com'],
    ['Ward@ACME.com', 'acme.com'],
    ['a@b@acme.com', 'acme.com'],
  ])('reads %s as %s', (email, expected) => {
    expect(domainOf(email)).toBe(expected);
  });

  it.each([['notanemail'], ['@acme.com'], ['ward@'], ['']])('rejects %j', (email) => {
    expect(domainOf(email)).toBeNull();
  });
});

describe('domain restriction', () => {
  it('admits an allowed domain', () => {
    expect(allow('ward@acme.com', restricted(['acme.com']))).toBe(true);
  });

  it('refuses a different domain', () => {
    expect(allow('ward@other.com', restricted(['acme.com']))).toBe(false);
  });

  // The three addresses an `endsWith` implementation would wrongly admit. This is the
  // reason the check is an exact match, and these are the cases that prove it.
  it.each([
    ['x@evil-acme.com'],
    ['x@acme.com.attacker.net'],
    ['x@acme.com.co'],
  ])('refuses the look-alike %s', (email) => {
    expect(allow(email, restricted(['acme.com']))).toBe(false);
  });

  it('does not imply subdomains', () => {
    expect(allow('x@mail.acme.com', restricted(['acme.com']))).toBe(false);
  });

  it.each([
    ['Ward@ACME.com', ['acme.com']],
    ['ward@acme.com', ['ACME.COM']],
    ['ward@acme.com', ['@acme.com']],
    ['ward@acme.com', [' acme.com ']],
  ])('normalises %s against %j', (email, domains) => {
    expect(allow(email, restricted(domains))).toBe(true);
  });

  it('refuses everyone when the allowlist is empty', () => {
    expect(allow('ward@acme.com', restricted([]))).toBe(false);
  });
});

describe('invite only', () => {
  const invited: RegistrationRules = {
    policy: 'INVITE_ONLY',
    allowedEmailDomains: ['ward@acme.com'],
  };

  it('admits a listed address', () => {
    expect(allow('ward@acme.com', invited)).toBe(true);
  });

  it('refuses an unlisted address on the same domain', () => {
    expect(allow('other@acme.com', invited)).toBe(false);
  });
});

describe('existing accounts', () => {
  // Tightening the policy governs who may join. Applying it to people who are already
  // here would make a configuration change silently revoke access.
  it('keeps access for a user who no longer satisfies the policy', () => {
    expect(allow('ward@old.com', restricted(['acme.com']), true)).toBe(true);
  });
});
