import { UserRole } from '@prisma/client';

/**
 * The authenticated caller, as the application understands them.
 *
 * `role` is read from our own users table, never from a token claim — the identity
 * provider answers "who is this", the application answers "what may they do here".
 * See docs/DECISIONS.md, ADR-0012.
 */
export interface Principal {
  /** Local user id. Foreign keys reference this, not the token subject. */
  userId: string;
  /** The OIDC `sub` claim. */
  idpSubject: string;
  email: string;
  displayName: string;
  role: UserRole;
}

/** The subset of token claims the application relies on. */
export interface TokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}
