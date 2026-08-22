import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/feedbackhub',
    KEYCLOAK_ISSUER_URL: 'http://localhost:8080/realms/feedbackhub',
  };

  it('applies defaults for optional variables', () => {
    const env = validateEnv({ ...valid });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200']);
  });

  it('coerces PORT from the string the environment always provides', () => {
    expect(validateEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('splits and trims the CORS allowlist', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: 'http://localhost:4200, https://feedback.example.com ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'https://feedback.example.com']);
  });

  it('rejects a missing database URL rather than starting', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an issuer that is not an absolute URL', () => {
    expect(() => validateEnv({ ...valid, KEYCLOAK_ISSUER_URL: 'localhost:8080' })).toThrow(
      /absolute URL/,
    );
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /PostgreSQL connection string/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => validateEnv({ ...valid, PORT: 'http' })).toThrow(/PORT/);
  });

  // The administrator bootstrap needs an address, a password, and the realm-administrator
  // credentials to apply them with. Half a configuration starts the API and then fails at
  // boot, which is the discovery-at-runtime this schema exists to prevent.
  describe('the administrator bootstrap', () => {
    const bootstrap = {
      ...valid,
      BOOTSTRAP_ADMIN_EMAIL: 'admin@feedbackhub.local',
      BOOTSTRAP_ADMIN_PASSWORD: 'Passw0rd!demo',
      KEYCLOAK_ADMIN_PASSWORD: 'admin',
    };

    it('accepts a complete configuration', () => {
      const env = validateEnv({ ...bootstrap });

      expect(env.BOOTSTRAP_ADMIN_EMAIL).toBe('admin@feedbackhub.local');
      expect(env.KEYCLOAK_ADMIN_USERNAME).toBe('admin');
    });

    it('is optional in its entirety', () => {
      expect(validateEnv({ ...valid }).BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
    });

    it('rejects a password with no address to apply it to', () => {
      expect(() =>
        validateEnv({
          ...valid,
          BOOTSTRAP_ADMIN_PASSWORD: 'Passw0rd!demo',
          KEYCLOAK_ADMIN_PASSWORD: 'admin',
        }),
      ).toThrow(/BOOTSTRAP_ADMIN_EMAIL/);
    });

    it('rejects a password with no realm-administrator credentials to set it with', () => {
      expect(() =>
        validateEnv({
          ...valid,
          BOOTSTRAP_ADMIN_EMAIL: 'admin@feedbackhub.local',
          BOOTSTRAP_ADMIN_PASSWORD: 'Passw0rd!demo',
        }),
      ).toThrow(/KEYCLOAK_ADMIN_PASSWORD/);
    });

    it('rejects a password too short to be worth setting', () => {
      expect(() => validateEnv({ ...bootstrap, BOOTSTRAP_ADMIN_PASSWORD: 'short' })).toThrow(
        /at least 8 characters/,
      );
    });

    // An email alone is the previous behaviour: nothing is written at start-up, and that
    // person is promoted the first time they sign in.
    it('allows an address without a password', () => {
      const env = validateEnv({ ...valid, BOOTSTRAP_ADMIN_EMAIL: 'admin@feedbackhub.local' });

      expect(env.BOOTSTRAP_ADMIN_EMAIL).toBe('admin@feedbackhub.local');
      expect(env.BOOTSTRAP_ADMIN_PASSWORD).toBeUndefined();
    });
  });
});
