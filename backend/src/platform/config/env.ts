import { z } from 'zod';

/**
 * Every environment variable the API reads, in one place.
 *
 * The application fails to start on invalid configuration rather than discovering it at
 * the first request that happens to need it. A container that cannot serve traffic should
 * not report itself as started.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection string'),

  /** Comma-separated list. No wildcard: the allowlist is explicit per environment. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  /**
   * The realm's issuer URL, exactly as it appears in the `iss` claim. Tokens whose issuer
   * differs are rejected, so a mismatch here is a hard failure rather than a warning.
   */
  KEYCLOAK_ISSUER_URL: z.string().regex(/^https?:\/\//, 'must be an absolute URL'),

  /** Expected `aud` claim. Without this check the API accepts any token the realm issued. */
  KEYCLOAK_AUDIENCE: z.string().min(1).default('feedbackhub-api'),

  /**
   * The first user with this email is provisioned as an admin, so a clean install has a
   * working administrator without a manual database edit.
   */
  BOOTSTRAP_ADMIN_EMAIL: z
    .string()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'must be an email address')
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
