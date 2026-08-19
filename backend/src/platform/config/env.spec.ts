import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/feedbackhub',
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
});
