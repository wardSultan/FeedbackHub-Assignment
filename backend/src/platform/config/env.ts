import { z } from 'zod';

/**
 * Every environment variable the API reads, in one place.
 *
 * The application fails to start on invalid configuration rather than discovering it at
 * the first request that happens to need it. A container that cannot serve traffic should
 * not report itself as started.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL connection string'),

    /** Comma-separated list. No wildcard: the allowlist is explicit per environment. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:4200')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    /**
     * The realm's issuer URL, exactly as it appears in the `iss` claim. Tokens whose issuer
     * differs are rejected, so a mismatch here is a hard failure rather than a warning.
     */
    KEYCLOAK_ISSUER_URL: z.string().regex(/^https?:\/\//, 'must be an absolute URL'),

    /** Expected `aud` claim. Without this check the API accepts any token the realm issued. */
    KEYCLOAK_AUDIENCE: z.string().min(1).default('feedbackhub-api'),

    /**
     * Keycloak's root URL as the *API process* reaches it, which is not always the issuer:
     * under Docker the browser sees `localhost:8080` while the API sees `keycloak:8080`.
     * Defaults to the issuer's origin, which is correct whenever both use the same name.
     *
     * Only the administrator bootstrap below uses it; token verification uses the issuer.
     */
    KEYCLOAK_BASE_URL: z
      .string()
      .regex(/^https?:\/\//, 'must be an absolute URL')
      .optional(),

    /** Realm-administrator account used by the bootstrap. Nothing else authenticates as it. */
    KEYCLOAK_ADMIN_USERNAME: z.string().min(1).default('admin'),

    KEYCLOAK_ADMIN_PASSWORD: z.string().min(1).optional(),

    /**
     * The first user with this email is provisioned as an admin, so a clean install has a
     * working administrator without a manual database edit.
     */
    BOOTSTRAP_ADMIN_EMAIL: z
      .string()
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'must be an email address')
      .optional(),

    /**
     * The password that account should have. Supplying it turns the passive rule above into
     * an active one: at start-up the API creates the Keycloak account if it is missing,
     * reconciles its password to this value, and makes the local row an administrator.
     *
     * Leave it unset and nothing is written at start-up — the email alone still promotes
     * the account the first time that person signs in, which is the previous behaviour.
     */
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8, 'must be at least 8 characters').optional(),
  })
  /**
   * The bootstrap needs three things or none: an address to create, a password to set,
   * and the realm-administrator credentials to do it with. Half a configuration would
   * start the API and then fail at boot, which is exactly the discovery-at-runtime this
   * file exists to prevent.
   */
  .superRefine((env, ctx) => {
    if (env.BOOTSTRAP_ADMIN_PASSWORD === undefined) {
      return;
    }

    if (env.BOOTSTRAP_ADMIN_EMAIL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
        message: 'is required when BOOTSTRAP_ADMIN_PASSWORD is set',
      });
    }

    if (env.KEYCLOAK_ADMIN_PASSWORD === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['KEYCLOAK_ADMIN_PASSWORD'],
        message: 'is required when BOOTSTRAP_ADMIN_PASSWORD is set',
      });
    }
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
